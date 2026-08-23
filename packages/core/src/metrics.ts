import { z } from 'zod'

/**
 * The numbers an axis measured, kept rather than summarised into prose.
 *
 * This exists because of one bug repeated across three axes. Each of them computes real figures
 * and then keeps only a sentence: `measureAuthority` works out referring domains, earned-media
 * domains and the exact list of publications that mention the brand without linking to it, and
 * persists a paragraph in `coverage.note`. `measureSearch` queries Search Console and keeps the
 * findings but not the clicks. The result was a product that measures a great deal and can show
 * almost none of it, because prose is not something a page can render as a number.
 *
 * One object rather than a column per axis, because the shape is "what this axis measured this
 * run" and axes keep arriving. It sits beside the scorecard on the audit, which is stored whole
 * for the same reason.
 *
 * Everything here is optional. An axis that did not run this audit has no entry, and that is not
 * the same as an axis that ran and found nothing.
 */

/**
 * What the authority axis measured.
 *
 * `referringDomains` is nullable and the null is load-bearing: it is the difference between a site
 * with no backlinks and a deployment with no backlink index configured. ADR-0018 spends a page on
 * why those must never render alike, and a dashboard is the easiest place in the product to
 * collapse them by accident.
 */
export const authorityMetricsSchema = z.object({
  /** Distinct domains linking to the site, or null when no backlink index is configured. */
  referringDomains: z.number().int().min(0).nullable(),
  /** How many of the linking domains we enumerated, so a caller can qualify what it derives. */
  referringDomainsSampled: z.number().int().min(0).optional(),
  /** Distinct earned-media domains that mention the brand. The axis's headline number. */
  earnedDomains: z.number().int().min(0),
  /** Self-publishing platforms carrying the brand. Not authority, not an error either. */
  selfPublishedDomains: z.number().int().min(0),
  /**
   * Domains that mention the brand without linking to it: the AUTH-004 list, and the most
   * actionable thing on the axis. Undefined when no backlink index was consulted, which is not
   * the same as an empty array meaning everybody links.
   */
  unlinkedMentions: z.array(z.string()).optional(),
})
export type AuthorityMetrics = z.infer<typeof authorityMetricsSchema>

/** What Search Console reported for the window, which the findings alone never carried. */
export const searchMetricsSchema = z.object({
  clicks: z.number().int().min(0),
  impressions: z.number().int().min(0),
  /** 0..1. Stored as the fraction, formatted once at the edge. */
  ctr: z.number().min(0).max(1),
  /** Average position across those impressions. */
  position: z.number().min(0),
  startDate: z.string(),
  endDate: z.string(),
})
export type SearchMetrics = z.infer<typeof searchMetricsSchema>

export const auditMetricsSchema = z.object({
  authority: authorityMetricsSchema.optional(),
  search: searchMetricsSchema.optional(),
})
export type AuditMetrics = z.infer<typeof auditMetricsSchema>
