import { z } from 'zod'
import { axisSchema } from './axis.js'
import { effortSchema } from './effort.js'
import { evidenceSchema } from './evidence.js'
import { severitySchema } from './severity.js'
import { metricSnapshotSchema, verificationResultSchema } from './verification.js'

export const findingStatusSchema = z.enum([
  'open',
  'pr_open',
  'merged',
  'verified',
  'rejected',
  'wontfix',
])

export type FindingStatus = z.infer<typeof findingStatusSchema>

/**
 * A finding is an observation, not an opinion.
 *
 * Two fields carry the whole philosophy of the product:
 *
 * `evidence` is what we actually saw, machine-verifiable, so no finding can be
 * hallucinated. `falsification` is how we would know the fix failed, so no finding
 * can be unfalsifiable advice. Both are required. A finding constructed without a
 * falsification condition does not compile, and one constructed with an empty one
 * does not validate.
 *
 * This is the only place that rule is enforced, and every package depends on it.
 */
export const findingSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),

  /** The rule that raised it, e.g. 'TECH-007'. Rules are deterministic; see ADR-0001. */
  ruleId: z.string().min(1),

  axis: axisSchema,
  severity: severitySchema,

  /** How sure the detector is, 0 to 1. A parser that saw a 404 should say 1. */
  confidence: z.number().min(0).max(1),

  title: z.string().min(1),
  evidence: evidenceSchema,
  affectedUrls: z.array(z.string().url()),

  estimatedEffort: effortSchema,

  /** 0 to 100. Relative, not a promise of traffic. */
  estimatedImpact: z.number().min(0).max(100),

  /**
   * "How would we know this fix failed?" Required, and non-empty.
   *
   * Unfalsifiable advice is banned (CLAUDE.md rule 3). If you cannot say what
   * would disprove you, you do not have a finding, you have a vibe.
   */
  falsification: z.string().min(1),

  /** Can a fixer generate a diff for this, or is it advice for a human? */
  fixable: z.boolean(),

  status: findingStatusSchema.default('open'),
  prUrl: z.string().url().optional(),

  /** Captured before the fix, so the verifier has something to compare against. */
  baseline: metricSnapshotSchema.optional(),
  verification: verificationResultSchema.optional(),
})

export type Finding = z.infer<typeof findingSchema>

/**
 * Validate at the package boundary. Anything crossing into or out of the rule
 * engine, the database, or the API goes through here, so a malformed finding
 * fails loudly at the seam rather than quietly in the UI.
 */
export function parseFinding(input: unknown): Finding {
  return findingSchema.parse(input)
}
