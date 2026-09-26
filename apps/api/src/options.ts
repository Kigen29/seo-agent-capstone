import type { OutreachLlm } from '@seo/agent'
import type { IdentityProvider, KeywordProvider, OAuthConfig, SerpProvider } from '@seo/connectors'
import type { runQuickCheck } from '@seo/audit'
import type { Database } from '@seo/db'
import type { AuditJob, ConfirmVerifyJob, FixJob, VerifyFixJob, VerifyJob } from '@seo/queue'
import type { GitHubApp } from '@seo/vcs'

export interface AppOptions {
  db?: Database
  /** Origins allowed to call the API from a browser. The web app, and nothing else. */
  corsOrigins?: string[]
  /**
   * Puts an audit on the queue and nudges the worker. Injected rather than built here, so the
   * route knows nothing about pg-boss or GitHub, and a test can pass a spy. When absent,
   * `POST /audits` reports 503 rather than creating a queued row that nothing will ever run.
   */
  enqueue?: (job: AuditJob) => Promise<unknown>
  /**
   * Puts a verification-PR job on the queue and nudges the worker. Injected like `enqueue`.
   * Absent means `POST /sites/:id/verify` reports 503 rather than accepting work nothing runs.
   */
  enqueueVerify?: (job: VerifyJob) => Promise<unknown>
  /**
   * Puts a confirm-verification job on the queue when a verification PR is merged. Injected like
   * the others; absent means the webhook still acknowledges the merge but does not auto-confirm.
   */
  enqueueConfirmVerify?: (job: ConfirmVerifyJob) => Promise<unknown>
  /**
   * Puts a fix-PR job on the queue and nudges the worker. Injected like the others; absent means
   * `POST /findings/:id/fix` reports 503 rather than accepting work nothing will run.
   */
  enqueueFix?: (job: FixJob) => Promise<unknown>
  /**
   * Puts a verify-fix job on the queue when a fix PR is merged. Injected like the others; absent
   * means the webhook still marks the finding merged but does not auto-verify it.
   */
  enqueueVerifyFix?: (job: VerifyFixJob) => Promise<unknown>
  /**
   * A keyword-research provider for a tenant, already wrapped in that tenant's budget guard.
   *
   * A factory rather than a provider, because the guard is per-tenant (ADR-0017) and the tenant is
   * only known once a request has authenticated. Injected like everything else here so the route
   * can be tested with a fake and no spend, and so the app never reads credentials from the
   * environment itself. Absent, or returning undefined, means the route reports the axis as
   * unconfigured rather than erroring.
   *
   * It is handed this app's `Database` rather than opening its own. The spend ledger the guard
   * reads lives in the same Postgres as everything else, and a second pool on a free tier with a
   * hard connection ceiling is a real cost for no benefit.
   */
  keywords?: (tenantId: string, db: Database) => KeywordProvider | undefined
  /**
   * A SERP provider for a tenant, already wrapped in that tenant's budget guard.
   *
   * The same factory shape as `keywords`, and present for one route: the People Also Ask half of
   * question mining. Every other SERP query in the product runs on the worker to a schedule; this
   * one is interactive, because somebody planning content asks for it and waits.
   *
   * Absent means the route returns the Search Console half and says the paid half is not
   * configured, rather than erroring or pretending.
   */
  serp?: (tenantId: string, db: Database) => SerpProvider | undefined
  /**
   * A model client for a tenant, already wrapped in that tenant's budget guard.
   *
   * The same factory shape as `keywords`, and for the same reason: the guard is per-tenant
   * (ADR-0017) and the tenant is only known once a request has authenticated.
   *
   * This is the first LLM call the API makes; every other one in the product runs on the worker.
   * Drafting is the exception because it is interactive. A fix PR is worth waiting for, so it is
   * queued; a paragraph of email a human is about to edit is not worth a worker start, which
   * #142 measured in hours when `repository_dispatch` is not configured. The spend rules do not
   * change: the same `createBudgetGuard` wraps the call, so it is checked before and recorded
   * after exactly as the worker's is.
   *
   * Absent means `POST /sites/:id/outreach` reports 503 rather than pretending to draft.
   */
  outreach?: (tenantId: string, db: Database) => OutreachLlm | undefined
  /**
   * Google OAuth. Injected so the connection routes can be tested with a mocked token
   * endpoint, and so the app never reads process.env directly. Absent means the routes report
   * 503 rather than sending users to a half-configured consent screen.
   */
  google?: { config: OAuthConfig; fetch?: typeof globalThis.fetch }
  /**
   * The GitHub App (ADR-0002). Injected, like Google, so the connect and webhook routes can be
   * tested with a fake app and a known secret, and so the API never reads the App credentials
   * from process.env directly. Absent means those routes report 503 rather than pretend.
   */
  github?: {
    userAuthorization?: import('@seo/connectors').InstallationAccessOptions
    app: GitHubApp
    /** The App's URL slug, for building the install link `github.com/apps/<slug>`. */
    slug: string
    /** The secret GitHub signs each webhook with, so we can prove a delivery is genuine. */
    webhookSecret: string
  }
  /**
   * The social sign-in providers, keyed by name: `github`, `google`.
   *
   * A map rather than two fields, so the routes iterate rather than branch and a third provider
   * is a line in the composition root. Injected like everything else here, so the app never reads
   * client secrets itself and a test can sign somebody in without a network.
   *
   * A provider whose credentials are absent is simply not in the map, and its button does not
   * render. That is the same posture every connector takes: missing configuration degrades the
   * feature honestly rather than erroring.
   */
  identityProviders?: Record<string, IdentityProvider>
  /**
   * What a tenant created by a social sign-in may spend per month, in micro-dollars.
   *
   * This deployment is open: anyone with a GitHub or Google account can sign in and gets a
   * tenant. The cap is what bounds that, and it is per tenant rather than global, so N signups
   * is N caps and not one shared pot. Set `NEW_TENANT_BUDGET_MICROS=0` to let strangers use
   * everything that is free (crawl, the rule engine, the scorecard, fix pull requests, Search
   * Console verification) while spending nothing on the paid model and SERP calls.
   *
   * Undefined leaves the column default alone.
   */
  newTenantBudgetMicros?: number
  /**
   * The fetch used to follow a Google Maps share link.
   *
   * Its own field rather than a reuse of `google.fetch`, which exists for the OAuth token
   * endpoint: this one follows a URL a *user* supplied, which is a different trust level and the
   * reason `resolveMapsUrl` re-checks every hop against a host allow-list. Injected so a test can
   * drive the redirect chain, including the hop that leaves Google, without a network.
   */
  mapsFetch?: typeof globalThis.fetch
  /**
   * The fetch the anonymous check uses to reach the page it was asked about.
   *
   * Injected for the same reason `mapsFetch` is, and with more at stake: this one fetches a URL
   * chosen by a stranger, so the test that proves a refusal is refused must not depend on somebody
   * else's DNS. In production this is unset and `publicFetch` uses the platform's own.
   */
  checkFetch?: typeof globalThis.fetch
  /** DNS resolution for the check's guard, injected with `checkFetch` so a test is hermetic. */
  checkResolve?: NonNullable<Parameters<typeof runQuickCheck>[1]>['resolve']
  /**
   * What the anonymous check allows per address and in total, per day.
   *
   * Injectable because the limiter is *stateful*: it counts rows in the database, so a test suite
   * that ran it a few times would start failing on its own leftovers, and one that wanted to
   * assert the 429 would have to run six checks to get there. Production leaves this unset and
   * takes the constants in the route.
   */
  checkLimits?: { perIpDaily?: number; globalDaily?: number }
  /**
   * How many reverse proxies sit between the internet and this process, counted from our side.
   *
   * The client address is then taken that many hops back along X-Forwarded-For, from the right.
   * Counting from the right is what makes it unforgeable: a client can prepend whatever it likes to
   * the header, but every proxy we trust appends, so the entries nearest us are the ones our own
   * proxies wrote. The first hop is only trusted when the peer is on a private network (see
   * trustedProxy). Zero (the default) trusts nothing and uses the socket address, which behind a
   * proxy is the proxy: every visitor then shares one per-address quota, which is safe but blunt.
   * Set it only to a count measured on the real deployment; one too many lets clients choose
   * their own address.
   */
  trustProxyHops?: number
  /** Temporary: expose /diagnostic/forwarding to measure the proxy chain. Off unless set. */
  proxyDiagnostic?: boolean
  /** Where the OAuth callback sends the browser when it is done. The web app's origin. */
  webUrl?: string
}

/**
 * What a route module is handed.
 *
 * Every route needs the database and the injected collaborators, and nothing else. Passing this
 * one object rather than threading four parameters means adding a collaborator is a change to
 * {@link AppOptions} and the one route that uses it, not to every signature in between.
 *
 * `webUrl` is resolved once in `buildApp` rather than per module, so two routes cannot disagree
 * about where the browser goes after an OAuth round trip.
 */
export interface RouteDeps {
  db: Database
  options: AppOptions
  /** Where an OAuth callback sends the browser when it is done. The web app's origin. */
  webUrl: string
}

/**
 * Every route is authenticated, and every route is scoped.
 *
 * `request.tenantId` is set by the onRequest hook below, or the request never reaches a
 * handler at all. So there is no way to write a handler that forgets to authenticate: it
 * would have nothing to pass to `withTenant`, and it would not compile.
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
    /** The exact bytes of a webhook body, kept so its HMAC signature can be verified. */
    rawBody?: string
  }
}
