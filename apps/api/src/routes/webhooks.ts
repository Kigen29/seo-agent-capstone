import { applyFixPrOutcome, applyVerifyPrOutcome } from '@seo/audit'
import { asOwner, sites } from '@seo/db'
import { SIGNATURE_HEADER, verifyWebhookSignature } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../options.js'

/** The slice of a GitHub webhook body we actually read. The rest is ignored on purpose. */
interface GithubWebhookPayload {
  action?: string
  installation?: { id?: number }
  pull_request?: { merged?: boolean; head?: { ref?: string }; html_url?: string }
}

/**
 * The webhook GitHub calls when an installation changes or a pull request moves.
 *
 * Async, and registered rather than called, because it needs its own content-type parser: GitHub
 * signs the exact bytes it sent, and re-serialising a parsed object would not reproduce them, so
 * the HMAC would never match. Scoping the parser to this plugin leaves the rest of the API on
 * Fastify's default JSON handling.
 */
export async function githubWebhookRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, options } = deps

  await app.register(async (webhookRoutes) => {
    webhookRoutes.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (req, body, done) => {
        req.rawBody = typeof body === 'string' ? body : body.toString('utf8')
        try {
          done(null, req.rawBody === '' ? {} : JSON.parse(req.rawBody))
        } catch (err) {
          done(err as Error, undefined)
        }
      },
    )

    webhookRoutes.post('/webhooks/github', async (request, reply) => {
      if (!options.github) {
        return reply
          .status(503)
          .send({ error: 'Service Unavailable', message: 'GitHub is not configured.' })
      }

      const signature = request.headers[SIGNATURE_HEADER]
      const ok = verifyWebhookSignature(
        options.github.webhookSecret,
        request.rawBody ?? '',
        typeof signature === 'string' ? signature : undefined,
      )
      if (!ok) {
        // Anyone can POST to a public URL; only GitHub can sign. An unverified delivery is
        // turned away before a single field of it is read.
        return reply.status(401).send({ error: 'Unauthorized', message: 'Bad signature.' })
      }

      const event = request.headers['x-github-event']
      const payload = request.body as GithubWebhookPayload

      if (
        event === 'installation' &&
        (payload.action === 'deleted' || payload.action === 'suspend')
      ) {
        // The App was removed or suspended: no site under this installation can be fixed any
        // more, so clear the link. asOwner because a webhook carries no tenant context, and the
        // installation id spans whatever sites, in whatever tenants, were connected through it.
        const installationId = payload.installation?.id
        if (installationId) {
          await asOwner(db, (tx) =>
            tx
              .update(sites)
              .set({ githubInstallationId: null, repoFullName: null })
              .where(eq(sites.githubInstallationId, installationId)),
          )
        }
      }

      // A verification PR closing drives the site's status. The webhook has no tenant context,
      // so the site (and its tenant) is looked up from the branch name; asOwner because there is
      // no request tenant to scope by here.
      //
      //   merged -> mark merged, and enqueue a confirm job that asks Google to check (retrying
      //             while the deploy lands).
      //   closed -> if a PR was open, reset to none so the dashboard offers Verify again.
      if (event === 'pull_request' && payload.action === 'closed') {
        const ref = payload.pull_request?.head?.ref ?? ''
        const match = ref.match(
          /^seo-agent\/AGENT-VERIFY-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i,
        )
        if (match) {
          const siteId = match[1]!
          const [site] = await asOwner(db, (tx) =>
            tx
              .select({ tenantId: sites.tenantId, status: sites.gscVerificationStatus })
              .from(sites)
              .where(eq(sites.id, siteId))
              .limit(1),
          )

          const outcome = {
            merged: Boolean(payload.pull_request?.merged),
            closed: true, // this handler only runs for action === 'closed'
          }
          if (site) await applyVerifyPrOutcome(db, siteId, outcome, options.enqueueConfirmVerify)
        }

        // A fix PR closing drives its finding's status. The finding is matched by the PR URL we
        // stored when we opened it, which is exact where a branch name is not (a rule key is only
        // unique within an audit). asOwner because a webhook carries no tenant context.
        //
        //   merged -> mark merged, and enqueue a re-audit that verifies whether the fix held.
        //   closed -> if a PR was open, reset to open so the finding can be fixed again.
        const prUrl = payload.pull_request?.html_url
        if (prUrl) {
          await applyFixPrOutcome(
            db,
            prUrl,
            { merged: Boolean(payload.pull_request?.merged), closed: true },
            options.enqueueVerifyFix,
          )
        }
      }

      return reply.status(204).send()
    })
  })
}
