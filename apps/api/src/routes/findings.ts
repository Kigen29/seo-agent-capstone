import {
  getFinding,
  getFixProgress,
  listFindings,
  MAX_PAGE_SIZE,
  listFixAttempts,
} from '@seo/audit'
import { axisSchema, findingStatusSchema, severitySchema } from '@seo/core'
import { findings, withTenant, sites } from '@seo/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { requestFix } from '../fix-request.js'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'
import { refreshWaitingPullRequest } from '../pr-refresh.js'

/** How many pull requests one request may ask for. */
export const BULK_FIX_LIMIT = 10

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
      // A merge whose webhook was lost is noticed here, when somebody looks (see pr-refresh.ts).
      if (await refreshWaitingPullRequest(deps, request.tenantId, finding, request.log)) {
        return { finding: (await getFinding(db, request.tenantId, request.params.id)) ?? finding }
      }
      return { finding }
    })

  /** Every attempt the agent made to fix this finding, newest first. 404 for another tenant's. */
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/findings/:id/attempts', { schema: { params: uuidParam } }, async (request, reply) => {
      const attempts = await listFixAttempts(db, request.tenantId, request.params.id)
      if (!attempts) return notFound(reply)
      return { attempts }
    })

  /**
   * Three scalars, for the poll that runs while a fix job is in flight.
   *
   * The sibling of `GET /audits/:id/progress`, and it exists for the same reason: the finding
   * page was the one place in the product where a click produced a banner and then silence until
   * the user reloaded by hand. Polling `GET /findings/:id` to learn whether a PR had appeared
   * would re-serialise the full evidence, baseline and verification JSON every few seconds.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/findings/:id/fix-progress',
      { schema: { params: uuidParam } },
      async (request, reply) => {
        const progress = await getFixProgress(db, request.tenantId, request.params.id)

        if (!progress) return notFound(reply)
        return progress
      },
    )

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
      const result = await requestFix(deps, request.tenantId, request.params.id, request.log)

      if (result.queued) return reply.status(202).send({ status: 'queued' })
      if (result.status === 404) return notFound(reply)
      return reply.status(result.status).send({
        error: result.status === 503 ? 'Service Unavailable' : 'Conflict',
        message: result.message,
      })
    })

  /**
   * Dismiss a finding as "won't fix", or reopen one (ADR-0050).
   *
   * The status has existed since the first schema, and an audit has always carried a dismissal
   * forward to the same finding on the next one. Nothing could set it. A person looking at a
   * finding they had decided to live with had no way to say so, and it came back in every
   * count and every list.
   *
   * Only between `open` and `wontfix`. A finding with a pull request open, merged or checked
   * is in the middle of something, and dismissing it would orphan that work, so those are
   * refused with the reason. Nothing is deleted: the finding and its evidence stay.
   */
  app
    .withTypeProvider<ZodTypeProvider>()
    .put(
      '/findings/:id/status',
      { schema: { params: uuidParam, body: z.object({ status: z.enum(['open', 'wontfix']) }) } },
      async (request, reply) => {
        const result = await withTenant(db, request.tenantId, async (tx) => {
          const [row] = await tx
            .select({ status: findings.status })
            .from(findings)
            .where(eq(findings.id, request.params.id))
            .for('update')
          if (!row) return 'missing' as const
          if (row.status !== 'open' && row.status !== 'wontfix') return row.status
          await tx
            .update(findings)
            .set({ status: request.body.status })
            .where(eq(findings.id, request.params.id))
          return 'saved' as const
        })

        if (result === 'missing') return notFound(reply)
        if (result !== 'saved') {
          const why: Record<string, string> = {
            pr_open: 'A pull request for this finding is open. Close or merge it first.',
            merged: 'A fix for this finding has been merged and is being checked.',
            verified:
              'This finding was fixed and the fix was confirmed, so there is nothing to dismiss.',
            rejected: 'A fix for this finding was merged and did not work. It stays on the record.',
          }
          return reply
            .status(409)
            .send({ error: 'Conflict', message: why[result] ?? 'This finding cannot be changed.' })
        }
        return { status: request.body.status }
      },
    )

  /**
   * Ask for a pull request for several findings of one site in one request.
   *
   * Each finding still gets its own pull request: one finding, one branch, one diff to review
   * and one thing to verify after it merges (rules 2 and 4). What this saves is the clicking.
   * With no ids it takes the site's open findings the agent can fix, most important first.
   *
   * Capped, because every one is a model call and a pull request in someone's review queue, and
   * a person who asked for ten can ask for the next ten when those are in. A finding that cannot
   * be queued does not stop the rest; it comes back with the reason.
   */
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sites/:id/fixes',
    {
      schema: {
        params: uuidParam,
        body: z
          .object({ findingIds: z.array(z.string().uuid()).min(1).max(BULK_FIX_LIMIT).optional() })
          .nullish(),
      },
    },
    async (request, reply) => {
      if (!options.enqueueFix) {
        return reply
          .status(503)
          .send({ error: 'Service Unavailable', message: 'The fixer is not configured.' })
      }
      const [site] = await withTenant(db, request.tenantId, (tx) =>
        tx.select({ id: sites.id }).from(sites).where(eq(sites.id, request.params.id)).limit(1),
      )
      if (!site) return notFound(reply)

      const eligible = await listFindings(db, request.tenantId, {
        siteId: site.id,
        fixable: true,
        status: 'open',
        sort: 'priority',
        pageSize: BULK_FIX_LIMIT,
      })
      const asked = request.body?.findingIds
      const titles = new Map(eligible.findings.map((finding) => [finding.rowId, finding.title]))
      const ids = asked ?? eligible.findings.map((finding) => finding.rowId)

      const queued: { id: string; title: string }[] = []
      const skipped: { id: string; title: string; reason: string }[] = []
      // One at a time: each is a short transaction, and the order is the priority order.
      for (const id of ids) {
        const result = await requestFix(deps, request.tenantId, id, request.log)
        const title = titles.get(id) ?? ''
        if (result.queued) queued.push({ id, title })
        else skipped.push({ id, title, reason: result.message })
      }

      return reply.status(202).send({
        queued,
        skipped,
        // What is left for a second request, when this one took the default selection.
        remaining: asked ? 0 : Math.max(0, eligible.total - ids.length),
      })
    },
  )
}
