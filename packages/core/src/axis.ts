import { z } from 'zod'

/**
 * The eight surfaces the product measures. They are scored independently and
 * never collapsed into a single number: they move independently, and one score
 * hides everything. See CLAUDE.md.
 */
export const axisSchema = z.enum([
  'crawl_health',
  'performance',
  'content',
  'structure',
  'authority',
  'local',
  'ai_visibility',
  'agent_readiness',
])

export type Axis = z.infer<typeof axisSchema>

export const AXES: readonly Axis[] = axisSchema.options
