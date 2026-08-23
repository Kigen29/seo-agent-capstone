import { getFinding, listFindings, MAX_PAGE_SIZE } from '@seo/audit'
import { axisSchema, findingStatusSchema, severitySchema } from '@seo/core'
import { withTenant, sites } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * The findings inbox, one finding, and the button that turns a finding into a pull request.
 */
export function findingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, options } = deps

    /**
     * The findings inbox: one page of the tenant's current findings, most important first.
     *
     * This took no parameters at all and returned every finding the tenant had. The web app then
     * filtered the whole downloaded list in the browser, which meant clicking a filter chip
     * re-fetched everything and discarded most of it. Filtering, sorting and paging now happen in
     * SQL against an indexed, stored priority score.
     *
     * Every parameter is validated and bounded here rather than trusted: `pageSize` is capped so a
     * caller cannot ask for the unpaginated behaviour this replaced by passing `pageSize=100000`.
     */
    app.withTypeProvider<ZodTypeProvider>().get(
      '/findings',
      {
        schema: {
          querystring: z.object({
            siteId: z.string().uuid().optional(),
            axis: axisSchema.optional(),
            severity: severitySchema.optional(),
            status: findingStatusSchema.optional(),
            fixable: z.enum(['true', 'false']).optional(),
            q: z.string().max(200).optional(),
            sort: z.enum(['priority', 'severity', 'title', 'axis']).optional(),
            page: z.coerce.number().int().min(1).optional(),
            pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
          }),
        },
      },
      async (request) => {
        const { fixable, ...rest } = request.query
        return listFindings(db, request.tenantId, {
          ...rest,
          ...(fixable === undefined ? {} : { fixable: fixable === 'true' }),
        })
      },
    )

    app
      .withTypeProvider<ZodTypeProvider>()
      .get('/findings/:id', { schema: { params: uuidParam } }, async (request, reply) => {
        const finding = await getFinding(db, request.tenantId, request.params.id)

        if (!finding) return notFound(reply)
        return { finding }
      })

    /**
     * Open a pull request that fixes a finding the caller owns. Enqueues the work; the worker
     * detects the framework, generates the diff, and opens the PR, then marks the finding
     * `pr_open` with the PR URL. The preconditions are checked here with a clear 409 rather than
     * letting the worker fail obscurely: the finding must be fixable in code, it must not already
     * have a PR open (or merged), and its site must have a repository connected. A finding that is
     * not the caller's is a 404, never a 403.
     */
    app
      .withTypeProvider<ZodTypeProvider>()
      .post('/findings/:id/fix', { schema: { params: uuidParam } }, async (request, reply) => {
        if (!options.enqueueFix) {
          return reply
            .status(503)
            .send({ error: 'Service Unavailable', message: 'The fixer is not configured.' })
        }

        const finding = await getFinding(db, request.tenantId, request.params.id)
        if (!finding) return notFound(reply)

        if (!finding.fixable) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'This finding cannot be fixed in code automatically; it needs a human.',
          })
        }
        if (finding.status !== 'open') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'A pull request for this finding has already been opened.',
          })
        }

        const [site] = await withTenant(db, request.tenantId, (tx) =>
          tx
            .select({ repo: sites.repoFullName, installation: sites.githubInstallationId })
            .from(sites)
            .where(eq(sites.id, finding.siteId))
            .limit(1),
        )
        if (!site || !site.repo || !site.installation) {
          return reply
            .status(409)
            .send({ error: 'Conflict', message: 'Connect a repository to this site first.' })
        }

        await options.enqueueFix({
          tenantId: request.tenantId,
          siteId: finding.siteId,
          findingRowId: finding.rowId,
        })
        return reply.status(202).send({ status: 'queued' })
      })
}
