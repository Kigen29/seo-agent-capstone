import { z } from 'zod'

export const effortSchema = z.enum(['trivial', 'small', 'medium', 'large'])
export type Effort = z.infer<typeof effortSchema>

/**
 * Roughly Fibonacci, the way story points are, because effort is not linear:
 * the gap between a medium and a large job is far wider than between a trivial
 * and a small one. This is the divisor in the priority score, so a large fix
 * has to earn its place by being genuinely high impact.
 */
const EFFORT_COST: Record<Effort, number> = {
  trivial: 1,
  small: 2,
  medium: 5,
  large: 13,
}

export function effortCost(effort: Effort): number {
  return EFFORT_COST[effort]
}
