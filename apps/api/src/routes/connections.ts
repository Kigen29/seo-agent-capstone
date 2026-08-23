import { buildAuthUrl, signState } from '@seo/connectors'
import { withTenant, oauthCredentials, sites } from '@seo/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound } from '../http.js'
import { signInstallState } from '../github-state.js'
import type { RouteDeps } from '../options.js'

/**
 * What this tenant has connected, and the two routes that start a connection: Google's consent
 * screen and the GitHub App install. Both hand back a URL for the browser; neither completes here.
 * The callbacks that finish the round trip are unauthenticated and live in `oauth-callbacks.ts`.
 */
export function connectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

  /** What this tenant has connected, so the UI can show it: Google, and any connected repos. */
  app.withTypeProvider<ZodTypeProvider>().get('/connections', async (request) => {
    const [google] = await withTenant(db, request.tenantId, (tx) =>
      tx
        .select({ email: oauthCredentials.accountEmail })
        .from(oauthCredentials)
        .where(eq(oauthCredentials.provider, 'google'))
        .limit(1),
    )

    const connectedRepos = await withTenant(db, request.tenantId, (tx) =>
      tx
        .select({ repoFullName: sites.repoFullName })
        .from(sites)
        .where(isNotNull(sites.githubInstallationId)),
    )
    const repos = connectedRepos
      .map((row) => row.repoFullName)
      .filter((name): name is string => Boolean(name))

    return {
      google: google ? { connected: true, email: google.email } : { connected: false },
      github: { connected: repos.length > 0, repos },
    }
  })

  /**
   * Begin connecting Google. Returns the consent URL for the browser to visit; the state in
   * it is signed for this authenticated tenant, so the eventual callback can trust it.
   */
  app.withTypeProvider<ZodTypeProvider>().post('/connections/google', async (request, reply) => {
    if (!options.google) {
      return reply
        .status(503)
        .send({ error: 'Service Unavailable', message: 'Google is not configured.' })
    }

    const state = signState(request.tenantId)
    return { url: buildAuthUrl(options.google.config, state) }
  })

  /**
   * Begin connecting a repository to a site the caller owns. Returns the GitHub App install
   * URL; the state in it is signed for this tenant and this site, so the setup callback can
   * write the resulting installation onto the right site and no other.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/connections/github',
      { schema: { body: z.object({ siteId: z.string().uuid() }) } },
      async (request, reply) => {
        if (!options.github) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'GitHub is not configured.' })
        }

        // Confirm the site is the caller's first (404, never 403, for someone else's), then
        // sign the state. A site that is not theirs cannot be named in a state we will honour.
        const site = await withTenant(db, request.tenantId, async (tx) => {
          const [row] = await tx
            .select({ id: sites.id, url: sites.url })
            .from(sites)
            .where(eq(sites.id, request.body.siteId))
            .limit(1)
          return row
        })
        if (!site) return notFound(reply)

        /**
         * Two ways to begin, because the App is installed once per tenant, not once per site.
         *
         * The FIRST repo is a fresh install: GitHub carries our signed `state` through it, and the
         * setup callback binds the repo. Every repo AFTER that must not re-install, because once
         * the App is installed GitHub runs a "configure" flow that drops the query string, so the
         * callback sees no state and the whole thing looks like a cancelled install ("The install
         * was cancelled. Nothing was connected."). So when the tenant already has an installation,
         * we do not guess a repo from the site's name (a repo can be named anything); we hand back
         * the repositories the App can see and let the user pick.
         */
        const installedRows = await withTenant(db, request.tenantId, (tx) =>
          tx
            .selectDistinct({ installationId: sites.githubInstallationId })
            .from(sites)
            .where(
              and(eq(sites.tenantId, request.tenantId), isNotNull(sites.githubInstallationId)),
            ),
        )
        const installationIds = installedRows
          .map((row) => row.installationId)
          .filter((id): id is number => id !== null)

        if (installationIds.length > 0) {
          const seen = new Set<string>()
          const repos: { fullName: string; installationId: number }[] = []
          for (const installationId of installationIds) {
            for (const repo of await options.github.app.listInstallationRepositories(
              installationId,
            )) {
              if (seen.has(repo.fullName)) continue
              seen.add(repo.fullName)
              repos.push({ fullName: repo.fullName, installationId })
            }
          }
          return {
            mode: 'pick' as const,
            repos,
            // Where the user grants access to a repo the App cannot see yet. The generic
            // installations page, not one installation, because a tenant may have installed the
            // App on more than one account and this lists them all.
            manageUrl: 'https://github.com/settings/installations',
          }
        }

        const state = signInstallState({
          tenantId: request.tenantId,
          siteId: request.body.siteId,
        })
        // `select_target`, not `new`. GitHub drops the query string when it 302s `new` to
        // `select_target`, so a state passed to `new` never reaches our setup URL and the
        // callback has no tenant or site to bind to. Linking straight to `select_target`
        // preserves the state through to the redirect. This is a known GitHub behaviour.
        const url =
          `https://github.com/apps/${options.github.slug}/installations/select_target` +
          `?state=${encodeURIComponent(state)}`
        return { mode: 'install' as const, url }
      },
    )
}
