import { readSchedule, saveAuditCadence } from '@seo/audit'
import { auditCadenceSchema, shiftMonth, utcDayOf } from '@seo/core'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { notFound, uuidParam } from '../http.js'
import type { RouteDeps } from '../options.js'

/**
 * A site's calendar: what ran, what is due, and what is coming (ADR-0044).
 *
 * Read from what is stored on every request. There is no table of future jobs, because the
 * worker has none either: it asks the database who is due each time it wakes, and this asks the
 * same questions for one site and one month.
 */

/** How far either side of this month a calendar may be asked for. */
const MONTHS_EITHER_SIDE = 12

export function scheduleRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db } = deps
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/sites/:id/schedule',
    {
      schema: {
        params: uuidParam,
        querystring: z.object({
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const now = new Date()
      const thisMonth = utcDayOf(now).slice(0, 7)
      const month = request.query.month ?? thisMonth

      // Bounded, because every extra month is a month of rows read, and a calendar for the year
      // 9999 is nobody's honest question.
      if (
        month < shiftMonth(thisMonth, -MONTHS_EITHER_SIDE) ||
        month > shiftMonth(thisMonth, MONTHS_EITHER_SIDE)
      ) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `The calendar covers ${MONTHS_EITHER_SIDE} months either side of this one.`,
        })
      }

      const schedule = await readSchedule(db, request.tenantId, request.params.id, month, now)
      if (!schedule) return notFound(reply)
      return schedule
    },
  )

  /** Turn scheduled audits on, off, or to another interval. Takes effect on the next wake. */
  typed.put(
    '/sites/:id/audit-cadence',
    { schema: { params: uuidParam, body: z.object({ cadence: auditCadenceSchema }) } },
    async (request, reply) => {
      const saved = await saveAuditCadence(
        db,
        request.tenantId,
        request.params.id,
        request.body.cadence,
      )
      if (!saved) return notFound(reply)
      return { auditCadence: saved }
    },
  )
}
