import {
  encryptToken,
  exchangeCode,
  verifyState,
  listGitHubUserInstallations,
  verifyGitHubInstallationAccess,
} from '@seo/connectors'
import { withTenant, oauthCredentials, sites } from '@seo/db'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { exchangeVercelCode, type InstalledRepo } from '@seo/vcs'
import { z } from 'zod'
import { signInstallState, verifyInstallState } from '../github-state.js'
import { connectVercel } from '../hosting-connect.js'
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
          code: z.string().max(4096).optional(),
          state: z.string().max(4096).optional(),
          error: z.string().max(4096).optional(),
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
          installation_id: z.coerce.number().int().positive().optional(),
          code: z.string().max(4096).optional(),
          setup_action: z.string().max(4096).optional(),
          state: z.string().max(4096).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { installation_id: suppliedInstallationId, state, code } = request.query

      if (!state) return reply.redirect(backToDashboardGithub('declined'))
      if (!options.github) return reply.redirect(backToDashboardGithub('unavailable'))

      const verified = verifyInstallState(state)
      if (!verified) return reply.redirect(backToDashboardGithub('invalid'))
      const { tenantId, siteId } = verified

      /**
       * The discovery leg: the user has signed in with GitHub, before any install. Bind an
       * installation they can already reach, or, only if there is none, send them to install.
       */
      if (verified.discover) {
        const authorization = options.github.userAuthorization
        if (!authorization) return reply.redirect(backToDashboardGithub('unavailable'))
        if (!code) return reply.redirect(backToDashboardGithub('declined'))
        try {
          const reachable = await listGitHubUserInstallations(code, authorization)
          if (!reachable) return reply.redirect(backToDashboardGithub('invalid'))
          if (reachable.length === 0) {
            const installState = signInstallState({ tenantId, siteId })
            return reply.redirect(
              `https://github.com/apps/${options.github.slug}/installations/select_target` +
                `?state=${encodeURIComponent(installState)}`,
            )
          }

          const site = await withTenant(db, tenantId, async (tx) => {
            const [row] = await tx.select().from(sites).where(eq(sites.id, siteId)).limit(1)
            return row
          })
          if (!site) return reply.redirect(backToDashboardGithub('invalid'))

          const candidates: (InstalledRepo & { installationId: number })[] = []
          for (const installationId of reachable) {
            for (const repo of await options.github.app.listInstallationRepositories(
              installationId,
            )) {
              candidates.push({ ...repo, installationId })
            }
          }
          if (candidates.length === 0) return reply.redirect(backToDashboardGithub('norepo'))

          // chooseRepoForSite returns one of the objects it was given, installation id included.
          const chosen = chooseRepoForSite(candidates, site.url) as (typeof candidates)[number]
          await withTenant(db, tenantId, (tx) =>
            tx
              .update(sites)
              .set({ repoFullName: chosen.fullName, githubInstallationId: chosen.installationId })
              .where(eq(sites.id, siteId)),
          )
          return reply.redirect(backToDashboardGithub('connected'))
        } catch (err) {
          console.error('github installation discovery failed', err)
          return reply.redirect(backToDashboardGithub('failed'))
        }
      }
      const installationId = verified.installationId ?? suppliedInstallationId
      if (!installationId) return reply.redirect(backToDashboardGithub('invalid'))
      const authorization = options.github.userAuthorization
      if (!authorization) return reply.redirect(backToDashboardGithub('unavailable'))
      if (!verified.installationId) {
        const params = new URLSearchParams({
          client_id: authorization.clientId,
          redirect_uri: authorization.redirectUri,
          state: signInstallState({ tenantId, siteId, installationId }),
        })
        return reply.redirect(`https://github.com/login/oauth/authorize?${params}`)
      }
      if (!code) return reply.redirect(backToDashboardGithub('declined'))

      try {
        if (!(await verifyGitHubInstallationAccess(code, installationId, authorization))) {
          return reply.redirect(backToDashboardGithub('invalid'))
        }
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

  /**
   * The Vercel consent callback. Unauthenticated for the same reason as the other two: it is a
   * browser redirect back from Vercel, carrying a code and our signed `state`, and no session.
   *
   * The state names the tenant and the site, so the credential is stored against a site this
   * server named. Nothing in the query is trusted to say which site: not the team, not the
   * configuration. The project is not taken from the query either; it is looked up from the
   * site's own repository and then proved to serve the site's own address, exactly as a pasted
   * token is (ADR-0028).
   */
  const backToHosting = (siteId: string | undefined, status: string) =>
    `${webUrl.replace(/\/$/, '')}/settings/connections/hosting?${new URLSearchParams({
      ...(siteId ? { siteId } : {}),
      vercel: status,
    }).toString()}`

  app.withTypeProvider<ZodTypeProvider>().get(
    '/connections/vercel/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().max(4096).optional(),
          state: z.string().max(4096).optional(),
          teamId: z.string().max(4096).optional(),
          configurationId: z.string().max(4096).optional(),
          next: z.string().max(4096).optional(),
          source: z.string().max(4096).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, teamId } = request.query

      if (!state) return reply.redirect(backToHosting(undefined, 'declined'))
      const verified = verifyInstallState(state)
      if (!verified) return reply.redirect(backToHosting(undefined, 'invalid'))
      const { tenantId, siteId } = verified

      if (!options.vercel) return reply.redirect(backToHosting(siteId, 'unavailable'))
      if (!code) return reply.redirect(backToHosting(siteId, 'declined'))

      try {
        const [site] = await withTenant(db, tenantId, (tx) =>
          tx.select().from(sites).where(eq(sites.id, siteId)).limit(1),
        )
        if (!site) return reply.redirect(backToHosting(siteId, 'invalid'))
        if (!site.repoFullName || !site.githubInstallationId)
          return reply.redirect(backToHosting(siteId, 'norepo'))

        const grant = await (options.exchangeVercelCode ?? exchangeVercelCode)(
          options.vercel,
          code,
          options.vercel.fetch,
        )
        // The team on the grant is Vercel's statement of what was approved. The one in the
        // query is only used when the grant names none, and only ever to scope a lookup.
        const team =
          grant.teamId ?? (teamId && /^team_[a-zA-Z0-9]+$/.test(teamId) ? teamId : undefined)

        const result = await connectVercel(
          { db, options },
          tenantId,
          {
            id: site.id,
            url: site.url,
            repoFullName: site.repoFullName,
            githubInstallationId: site.githubInstallationId,
          },
          { token: grant.token, ...(team ? { teamId: team } : {}) },
        )
        return reply.redirect(backToHosting(siteId, result.status))
      } catch (err) {
        // The message only: an error object from a fetch can carry the request, and the request
        // carried a client secret.
        request.log.error(
          `vercel consent callback failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
        return reply.redirect(backToHosting(siteId, 'failed'))
      }
    },
  )
}
