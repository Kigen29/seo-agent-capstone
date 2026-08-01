import { z } from 'zod'

/**
 * Evidence is what we actually observed, and it must be machine-verifiable.
 *
 * This type is the load-bearing half of rule 1 (deterministic detection, LLM second).
 * A rule cannot raise a finding on a hunch: it has to hand back the status code it
 * saw, the markup it parsed, or the metric it read. That is also what makes the
 * verifier possible, because "is it fixed?" is just "re-observe and compare".
 *
 * It is a discriminated union rather than a bag of strings so that a fixer can
 * branch on what it is looking at, and so a rule cannot quietly record prose.
 */

const evidenceSourceSchema = z.enum([
  'crawler', // our own Playwright crawl
  'crux', // Chrome UX Report, field data
  'psi', // PageSpeed Insights, lab data
  'gsc', // Search Console
  'repo', // the client's source tree
  'serp', // SERP or AI engine poll
])

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>

const evidenceBase = {
  observedAt: z.string().datetime(),
  source: evidenceSourceSchema,
}

/** An HTTP exchange: status codes, redirect chains, headers. */
export const httpEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('http'),
  url: z.string().url(),
  status: z.number().int(),
  /** Every hop, in order. A chain longer than one hop is itself a finding. */
  redirectChain: z.array(z.string().url()).default([]),
  headers: z.record(z.string()).optional(),
})

/** Something we parsed out of the markup, with the snippet that proves it. */
export const markupEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('markup'),
  url: z.string().url(),
  /** CSS selector or a short description of where we looked. */
  locator: z.string().min(1),
  /** What was actually there. Empty string means the element was absent. */
  snippet: z.string(),
})

/** A measured number. Core Web Vitals, click depth, word count, citation rate. */
export const metricEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('metric'),
  metric: z.string().min(1),
  value: z.number(),
  unit: z.enum(['ms', 's', 'score', 'count', 'ratio', 'percent']),
  /**
   * Core Web Vitals are only meaningful at the 75th percentile of real users.
   * Recording the percentile stops a lab number being passed off as a field one.
   */
  percentile: z.number().min(0).max(100).optional(),
  url: z.string().url().optional(),
})

/** A fact about the client's source tree. Feeds the fixers. */
export const fileEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('file'),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  excerpt: z.string(),
})

/** A fact derived from the internal link graph: orphans, click depth. */
export const graphEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('graph'),
  url: z.string().url(),
  inboundInternalLinks: z.number().int().min(0),
  /** Hops from the homepage. Null when the page is unreachable by crawling. */
  clickDepth: z.number().int().min(0).nullable(),
})

/**
 * A row of real search performance from Search Console: what a page actually ranks for, and
 * how it is doing. This is the evidence behind a quick win, and it is field data about real
 * Google users, not a crawl or a guess.
 *
 * The window is carried, not dropped, because every number here is a claim about a specific
 * span of days (and Search Console lags two to three, so "recent" always means a few days
 * back). `position` is the average rank, 1 being the top; `ctr` is 0..1.
 */
export const searchEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('search'),
  /** The page this row is about. Present when the query was grouped by page. */
  url: z.string().url().optional(),
  /** The search query, when the row is grouped by query. */
  query: z.string().optional(),
  position: z.number().min(0),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  ctr: z.number().min(0).max(1),
  startDate: z.string(),
  endDate: z.string(),
})

/**
 * What an AI answer engine did, over a poll window: the prompt we asked, how many times we
 * asked it, over how many days, and how often the client's domain came back.
 *
 * The counts are the honesty. A citation is a claim about a distribution, not about one
 * answer, because roughly 45% of citations appear in only one of three checks (ADR-0015), so
 * evidence that recorded a single "cited: true" would be evidence for a claim we refuse to
 * make. `pollsRun` and `daysPolled` are here so a reader can see the sample the verdict rests
 * on, and `matchedSources` carries the actual URLs the parser matched, which is what makes
 * the finding falsifiable: if no source in that list is the client's, the poller was wrong.
 */
export const citationEvidenceSchema = z.object({
  ...evidenceBase,
  kind: z.literal('citation'),
  /** The question we asked the engines, verbatim. */
  prompt: z.string().min(1),
  /** The engines polled, e.g. ['chatgpt', 'perplexity']. */
  engines: z.array(z.string()).default([]),
  pollsRun: z.number().int().min(0),
  citedCount: z.number().int().min(0),
  /** Distinct days the polls span. Below three, no citation verdict is reported at all. */
  daysPolled: z.number().int().min(0),
  /** The cited source URLs the parser matched to the client. Empty when never cited. */
  matchedSources: z.array(z.string()).default([]),
  /** Competitor domains cited for this prompt, deduplicated across the window. */
  citedCompetitors: z.array(z.string()).default([]),
  /**
   * The figures the answers agreed on, parsed out of the answer texts, when they named any.
   *
   * An observation rather than advice, which is why it belongs on the evidence: these are
   * numbers the engines actually printed. It is here because an answer is written first and
   * sources are then chosen to support it, so a page contradicting the consensus does not get
   * picked however true it is. Knowing the range is what lets a client state it and then put
   * their own numbers underneath.
   */
  consensus: z
    .object({
      currency: z.string().min(1),
      low: z.number(),
      high: z.number(),
      /** How many answers contributed a figure. Never below two. */
      answers: z.number().int().min(2),
    })
    .optional(),
})

export const evidenceSchema = z.discriminatedUnion('kind', [
  httpEvidenceSchema,
  markupEvidenceSchema,
  metricEvidenceSchema,
  fileEvidenceSchema,
  graphEvidenceSchema,
  searchEvidenceSchema,
  citationEvidenceSchema,
])

export type Evidence = z.infer<typeof evidenceSchema>
export type CitationEvidence = z.infer<typeof citationEvidenceSchema>
export type HttpEvidence = z.infer<typeof httpEvidenceSchema>
export type MarkupEvidence = z.infer<typeof markupEvidenceSchema>
export type MetricEvidence = z.infer<typeof metricEvidenceSchema>
export type FileEvidence = z.infer<typeof fileEvidenceSchema>
export type GraphEvidence = z.infer<typeof graphEvidenceSchema>
export type SearchEvidence = z.infer<typeof searchEvidenceSchema>
