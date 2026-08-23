import { encryptToken, exchangeCode, verifyState } from '@seo/connectors'
import { withTenant, oauthCredentials, sites } from '@seo/db'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { verifyInstallState } from '../github-state.js'
import type { RouteDeps } from '../options.js'
import { chooseRepoForSite } from '../repo-match.js'

/**
 * The two browser redirects that finish an OAuth round trip, and the only routes here that are
 * not authenticated.
 *
 * They cannot be. The user is mid-consent on Google's or GitHub's domain and has no session on
 * this API, so there is no token to present. What makes that safe is the signed `state`: it was
 * minted by an authenticated start route for one specific tenant, and the verifier refuses
 * anything forged, tampered with or stale. The tenant a credential is written against is
 * therefore always one this server named, never one the caller supplied.
 */
export function oauthCallbackRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options, webUrl } = deps

  /**
   * The Google OAuth callback. Unauthenticated on purpose: it is a browser redirect back from
   * Google and carries no bearer token. It cannot be, because the user is mid-consent and has
   * no session on this API.
   *
   * What makes that safe is the signed `state`. It was minted by the authenticated start route
   * for one specific tenant, and `verifyState` refuses anything forged, tampered with, or
   * stale. So the tenant this credential is stored against is one only this server could have
   * named, never one the caller supplied.
   */
  const backToDashboard = (status: string) =>
    `${webUrl.replace(/\/$/, '')}/dashboard?google=${status}`
  const backToDashboardGithub = (status: string) =>
    `${webUrl.replace(/\/$/, '')}/dashboard?github=${status}`

  app.withTypeProvider<ZodTypeProvider>().get(
    '/auth/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query

      // The user declined consent, or Google returned an error. Send them back with a note,
      // not a stack trace: declining is a choice, not a failure.
      if (error || !code || !state) return reply.redirect(backToDashboard('declined'))

      if (!options.google) return reply.redirect(backToDashboard('unavailable'))

      const tenantId = verifyState(state)
      if (!tenantId) return reply.redirect(backToDashboard('invalid'))

      try {
        const tokens = await exchangeCode(options.google.config, code, options.google.fetch)

        // Store the refresh token encrypted, never in the clear (ADR-0003). Upsert, so
        // re-connecting replaces the old grant rather than colliding on (tenant, provider).
        await withTenant(db, tenantId, (tx) =>
          tx
            .insert(oauthCredentials)
            .values({
              tenantId,
              provider: 'google',
              accountEmail: tokens.email,
              refreshTokenEncrypted: encryptToken(tokens.refreshToken),
              scopes: ['webmasters', 'siteverification'],
            })
            .onConflictDoUpdate({
              target: [oauthCredentials.tenantId, oauthCredentials.provider],
              set: {
                accountEmail: tokens.email,
                refreshTokenEncrypted: encryptToken(tokens.refreshToken),
                updatedAt: sql`now()`,
              },
            }),
        )

        return reply.redirect(backToDashboard('connected'))
      } catch (err) {
        // Never leak a token or a Google error detail into a redirect URL, where it would
        // land in browser history and server logs. Log it server-side, send back a generic
        // failure the dashboard can explain.
        console.error('google oauth callback failed', err)
        return reply.redirect(backToDashboard('failed'))
      }
    },
  )

  /**
   * The GitHub App setup callback. Unauthenticated for the same reason as the Google one: it is
   * a browser redirect back from GitHub after the user installs the App, carrying an
   * `installation_id` and our signed `state`, but no session on this API.
   *
   * The state is what makes it safe. It was signed for one tenant and one site by the
   * authenticated start route, so the installation is written onto a site the caller genuinely
   * owns, never one an unsigned parameter named.
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/connections/github/callback',
    {
      schema: {
        querystring: z.object({
          installation_id: z.coerce.number().optional(),
          setup_action: z.string().optional(),
          state: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { installation_id: installationId, state } = request.query

      if (!state || !installationId) return reply.redirect(backToDashboardGithub('declined'))
      if (!options.github) return reply.redirect(backToDashboardGithub('unavailable'))

      const verified = verifyInstallState(state)
      if (!verified) return reply.redirect(backToDashboardGithub('invalid'))
      const { tenantId, siteId } = verified

      try {
        const site = await withTenant(db, tenantId, async (tx) => {
          const [row] = await tx.select().from(sites).where(eq(sites.id, siteId)).limit(1)
          return row
        })
        if (!site) return reply.redirect(backToDashboardGithub('invalid'))

        // Which repo does this installation actually grant? Resolve it, and match it to the
        // site the user started from, so the fixer knows exactly which repo to open a PR against.
        const repos = await options.github.app.listInstallationRepositories(installationId)
        if (repos.length === 0) return reply.redirect(backToDashboardGithub('norepo'))

        const chosen = chooseRepoForSite(repos, site.url)

        await withTenant(db, tenantId, (tx) =>
          tx
            .update(sites)
            .set({ repoFullName: chosen.fullName, githubInstallationId: installationId })
            .where(eq(sites.id, siteId)),
        )

        return reply.redirect(backToDashboardGithub('connected'))
      } catch (err) {
        console.error('github install callback failed', err)
        return reply.redirect(backToDashboardGithub('failed'))
      }
    },
  )
}
