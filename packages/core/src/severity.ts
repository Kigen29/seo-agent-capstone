import { z } from 'zod'

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])
export type Severity = z.infer<typeof severitySchema>

/**
 * Weights double at each step, so one critical outranks any pile of mediums.
 *
 * That is deliberate. A site that has deleted itself from ChatGPT by blocking
 * OAI-SearchBot does not want its backlog led by forty missing alt attributes,
 * however cheap those are to fix. A linear scale would let volume drown urgency.
 */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 16,
  high: 8,
  medium: 4,
  low: 2,
  info: 1,
}

export function severityWeight(severity: Severity): number {
  return SEVERITY_WEIGHT[severity]
}
