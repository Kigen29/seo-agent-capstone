import { z } from 'zod'
import { findingSchema } from './finding.js'

export const auditStatusSchema = z.enum(['queued', 'crawling', 'evaluating', 'complete', 'failed'])
export type AuditStatus = z.infer<typeof auditStatusSchema>

export const auditSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  tenantId: z.string().min(1),
  status: auditStatusSchema.default('queued'),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  pagesCrawled: z.number().int().min(0).default(0),
  findings: z.array(findingSchema).default([]),
})

export type Audit = z.infer<typeof auditSchema>
