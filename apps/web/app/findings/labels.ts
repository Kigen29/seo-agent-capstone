import type { FindingStatus, Severity } from '@seo/core'

/** Axis ids as a human reads them. Shared by the table and the filter bar so they cannot drift. */
export const AXIS_LABEL: Record<string, string> = {
  crawl_health: 'Crawl health',
  performance: 'Performance',
  content: 'Content',
  structure: 'Structure',
  authority: 'Authority',
  local: 'Local',
  ai_visibility: 'AI visibility',
  agent_readiness: 'Agent readiness',
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export const STATUSES: FindingStatus[] = [
  'open',
  'pr_open',
  'merged',
  'verified',
  'rejected',
  'wontfix',
]

/**
 * How a finding's lifecycle state should read and look.
 *
 * The inbox fetched `status` and never rendered it, so a finding with a pull request already open
 * was indistinguishable from one nobody had touched. That is the single most useful column in a
 * triage list: it is the difference between work to do and work already in flight.
 */
export const STATUS_LABEL: Record<FindingStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'tag tag-neutral' },
  pr_open: { label: 'PR open', className: 'tag tag-outline' },
  merged: { label: 'Merged', className: 'tag tag-accent' },
  verified: { label: 'Verified', className: 'tag tag-success' },
  rejected: { label: 'Did not work', className: 'tag tag-critical' },
  wontfix: { label: 'Dismissed', className: 'tag tag-low' },
}
