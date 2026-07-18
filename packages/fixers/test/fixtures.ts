import type { Finding } from '@seo/core'

/** A valid, fixable finding for the fixer tests. Override any field to explore an edge. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'TECH-006-abc123',
    siteId: 'site-1',
    ruleId: 'TECH-006',
    axis: 'crawl_health',
    severity: 'high',
    confidence: 1,
    title: 'Missing canonical tag on the pricing page',
    evidence: {
      kind: 'markup',
      url: 'https://example.com/pricing',
      locator: 'head > link[rel=canonical]',
      snippet: '',
      observedAt: '2026-07-17T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls: ['https://example.com/pricing'],
    estimatedEffort: 'small',
    estimatedImpact: 60,
    falsification: 'A re-crawl still finds no canonical link on the affected pages.',
    fixable: true,
    status: 'open',
    ...overrides,
  }
}
