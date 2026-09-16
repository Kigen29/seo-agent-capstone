import { createBudgetGuard, recordSpend } from '@seo/budget'
import {
  budgetedKeywords,
  createDataForSeoKeywords,
  createGitHubIdentity,
  createGoogleIdentity,
  dataForSeoFromEnv,
  googleOAuthConfigFromEnv,
  type IdentityProvider,
} from '@seo/connectors'
import {
  createQueue,
  enqueueAudit,
  enqueueConfirmVerify,
  enqueueFix,
  enqueueVerify,
  enqueueVerifyFix,
} from '@seo/queue'
import { createGitHubApp, githubAppConfigFromEnv } from '@seo/vcs'
import { buildApp } from './app.js'
import { LlmClient } from '@seo/llm'
import { makeDispatcher } from './dispatch.js'

/**
 * Render sets PORT and expects the process to bind it on 0.0.0.0. Binding to localhost is
 * the single most common reason a container passes its build and then fails its health
 * check forever.
 */
const port = Number(process.env.PORT ?? 4000)
const host = '0.0.0.0'

/**
 * One queue instance for the process, started at boot. `createQueue` runs pg-boss migrations
 * and starts its maintenance, so it is not something to do per request.
 *
 * The dispatcher is composed in here, not in the app: enqueuing means "put it in pg-boss,
 * then nudge the worker to drain now". The app knows only that it calls `enqueue`.
 */
const queue = await createQueue()
const dispatch = makeDispatcher()

/**
 * Google OAuth is optional: if the credentials are not set, the connection routes report 503
 * and the rest of the API runs fine. So a missing config is a skipped feature, not a boot
 * failure, which is what lets the app deploy before the OAuth client exists.
 */
const google = (() => {
  try {
    return { config: googleOAuthConfigFromEnv() }
  } catch {
    console.warn('Google OAuth is not configured; the Search Console connection is disabled.')
    return undefined
  }
})()

/**
 * The GitHub App is optional in exactly the same way: without its credentials the connect and
 * webhook routes report 503 and the rest of the API runs, so the app can deploy before the App
 * is registered. It needs the App id and private key (GH_APP_ID, GH_APP_PRIVATE_KEY), the
 * webhook secret, and the public slug for building the install URL. GH_APP_*, not GITHUB_*,
 * because GitHub Actions reserves that prefix and the worker reads the same names from there.
 */
const github = (() => {
  try {
    const slug = process.env.GH_APP_SLUG
    const webhookSecret = process.env.GH_APP_WEBHOOK_SECRET
    if (!slug || !webhookSecret) {
      throw new Error('GH_APP_SLUG and GH_APP_WEBHOOK_SECRET are required.')
    }
    return { app: createGitHubApp(githubAppConfigFromEnv()), slug, webhookSecret }
  } catch (error) {
    // Log the actual reason, not just that it is off. A swallowed error here means an operator
    // sees "not configured" with no clue whether a variable is missing or the key is malformed.
    console.warn(
      'The GitHub App is not configured; connecting a repository is disabled. Reason:',
      error instanceof Error ? error.message : error,
    )
    return undefined
  }
})()

/**
 * Keyword research is optional in the same way, and off by default.
 *
 * The credentials are read once at boot; the provider is built per request, because the budget
 * guard it is wrapped in belongs to a tenant and the tenant is not known until a caller has
 * authenticated. Without credentials this is undefined and the route answers "not configured"
 * rather than erroring, which is the posture every paid surface here takes (ADR-0016, ADR-0021).
 */
const keywordCredentials = dataForSeoFromEnv()
if (!keywordCredentials) {
  console.warn('DataForSEO is not configured; keyword research and backlink data are disabled.')
}

/**
 * The social sign-in providers, assembled from whatever credentials are present.
 *
 * Each one is independent: GitHub configured and Google not means one button, not a boot
 * failure and not a half-working login page. The web app asks which providers exist and renders
 * only those, so the page can never offer a button that leads to a 503.
 *
 * The redirect URI must match what is registered on the GitHub App and the Google OAuth client.
 */
const identityProviders = (() => {
  /*
    The redirect URI is derived from this service's own public origin, and getting it wrong is
    silent until a user clicks the button.

    RENDER_EXTERNAL_URL is set automatically by Render for every web service, so the deployed API
    configures itself and there is no variable to forget. API_PUBLIC_URL overrides it for anywhere
    that is not Render. API_URL is the local development value.

    The localhost fallback is the dangerous one, and it is why the guard below exists: a
    production instance that fell back to it would render a perfectly good sign-in button that
    sends the user to Google and comes back `redirect_uri_mismatch`, which tells them nothing and
    tells us nothing either. No button at all is the better failure, because the login page still
    offers the token form and says so.
  */
  const base = (
    process.env.API_PUBLIC_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    process.env.API_URL ??
    `http://localhost:${process.env.PORT ?? 4000}`
  ).replace(/\/$/, '')

  const providers: Record<string, IdentityProvider> = {}

  if (process.env.NODE_ENV === 'production' && base.startsWith('http://localhost')) {
    console.error(
      'Social sign-in is disabled: no public URL is configured, so the OAuth redirect would ' +
        'point at localhost and every sign-in would fail at the provider. Set API_PUBLIC_URL ' +
        'to the public origin of this API.',
    )
    return providers
  }

  const redirectUri = `${base}/auth/signin/callback`

  if (process.env.GH_APP_CLIENT_ID && process.env.GH_APP_CLIENT_SECRET) {
    providers.github = createGitHubIdentity({
      clientId: process.env.GH_APP_CLIENT_ID,
      clientSecret: process.env.GH_APP_CLIENT_SECRET,
      redirectUri,
    })
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = createGoogleIdentity({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    })
  }

  const names = Object.keys(providers)
  if (names.length === 0) {
    console.warn('No social sign-in is configured; the login page falls back to API tokens.')
  } else {
    // Printed so a deploy log answers "why is there no GitHub button" without a debugging session.
    console.log(`social sign-in enabled for: ${names.join(', ')}; redirect ${redirectUri}`)
  }

  return providers
})()

/** See AppOptions.newTenantBudgetMicros. Undefined leaves the column default alone. */
const newTenantBudgetMicros = (() => {
  const raw = process.env.NEW_TENANT_BUDGET_MICROS
  if (raw === undefined || raw === '') return undefined

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined
})()

const keywordCostMicros = (() => {
  const usd = Number(process.env.KEYWORD_COST_PER_QUERY_USD)
  // The vendor's published rate at the default row count, rounded up. Errs high when unset,
  // which is the safe direction for a cost guard.
  return Math.round((Number.isFinite(usd) && usd > 0 ? usd : 0.02) * 1_000_000)
})()

const app = await buildApp({
  corsOrigins: process.env.WEB_URL ? [process.env.WEB_URL] : undefined,
  webUrl: process.env.WEB_URL,
  google,
  github,
  identityProviders,
  ...(newTenantBudgetMicros === undefined ? {} : { newTenantBudgetMicros }),
  keywords: keywordCredentials
    ? (tenantId, db) => {
        const guard = createBudgetGuard(db)

        return budgetedKeywords(createDataForSeoKeywords(keywordCredentials), {
          tenantId,
          checkBudget: guard.checkBudget,
          recordSpend: (id, entry) =>
            recordSpend(db, id, {
              kind: 'serp',
              provider: entry.provider,
              model: entry.model,
              micros: entry.micros,
            }),
          costPerQueryMicros: keywordCostMicros,
        })
      }
    : undefined,
  /*
    The tenant's model client, guarded exactly like the worker's.

    Composed here rather than in the route so the app never reads the chain from the environment
    itself and a test can hand in a fake that spends nothing. `LlmClient` resolves its chain from
    LLM_SMART and friends (ADR-0005), so an API with no keys configured has no chain, every call
    fails closed, and the route answers "no draft" rather than erroring.
  */
  outreach: (_tenantId, db) => {
    const guard = createBudgetGuard(db)

    return new LlmClient(async (id, usage) => {
      console.log(
        `api: llm spend for tenant ${id}: ~$${usage.estimatedUsd.toFixed(4)} ` +
          `(${usage.provider}:${usage.model}, ${usage.inputTokens}+${usage.outputTokens} tok)`,
      )
      await guard.recordSpend(id, usage)
    }, guard.checkBudget)
  },
  enqueue: async (job) => {
    await enqueueAudit(queue, job)
    await dispatch()
  },
  enqueueVerify: async (job) => {
    await enqueueVerify(queue, job)
    await dispatch()
  },
  enqueueConfirmVerify: async (job) => {
    await enqueueConfirmVerify(queue, job)
    await dispatch()
  },
  enqueueFix: async (job) => {
    await enqueueFix(queue, job)
    await dispatch()
  },
  enqueueVerifyFix: async (job) => {
    await enqueueVerifyFix(queue, job)
    await dispatch()
  },
})

try {
  await app.listen({ port, host })
  console.log(`api listening on ${host}:${port}`)
} catch (error) {
  console.error(error)
  await queue.stop({ graceful: false })
  process.exit(1)
}
