import { z } from 'zod'
import { metricEvidenceSchema } from './evidence.js'

/** What the affected pages looked like before we touched anything. */
export const metricSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  metrics: z.array(metricEvidenceSchema).min(1),
})

export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>

/**
 * A hypothesis is allowed to fail, and saying so is the product.
 *
 * "rejected" means we shipped the fix, waited, measured, and the metric did not
 * move. That is a real, reportable outcome, not an error. "inconclusive" is for
 * when the control group moved too, so a sitewide or seasonal drift makes the
 * result unattributable.
 */
export const verificationOutcomeSchema = z.enum(['verified', 'rejected', 'inconclusive'])
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>

export const verificationResultSchema = z.object({
  outcome: verificationOutcomeSchema,
  verifiedAt: z.string().datetime(),
  before: metricSnapshotSchema,
  after: metricSnapshotSchema,
  /**
   * Untouched pages, measured over the same window. Without them you cannot tell
   * your fix from the weather, and you end up shipping superstition.
   */
  control: metricSnapshotSchema.optional(),
  /** Plain-language statement of what moved, or of what conspicuously did not. */
  summary: z.string().min(1),
})

export type VerificationResult = z.infer<typeof verificationResultSchema>
