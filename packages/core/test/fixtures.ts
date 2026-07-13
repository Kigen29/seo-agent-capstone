import type { HttpEvidence } from '../src/evidence.js'
import type { Finding } from '../src/finding.js'

export const anEvidence: HttpEvidence = {
  kind: 'http',
  observedAt: '2026-07-13T09:00:00.000Z',
  source: 'crawler',
  url: 'https://example.com/pricing',
  status: 404,
  redirectChain: [],
}

/** A valid finding. Override one field per test so each test states its own point. */
export function aFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f_1',
    siteId: 's_1',
    ruleId: 'TECH-010',
    axis: 'crawl_health',
    severity: 'high',
    confidence: 1,
    title: 'Broken internal link',
    evidence: { ...anEvidence },
    affectedUrls: ['https://example.com/pricing'],
    estimatedEffort: 'trivial',
    estimatedImpact: 40,
    falsification: 'Re-crawl after the fix: the link still returns 404.',
    fixable: true,
    status: 'open',
    ...overrides,
  }
}
