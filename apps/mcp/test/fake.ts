import type { ApiClient } from '@seo/api-client'
import { parseFinding, type Finding } from '@seo/core'

/**
 * A fake API client, and a server harness that records what got registered.
 *
 * The same approach `packages/agent` takes with fake models: prove the mechanism without a
 * network, a database, or a running API. What is being tested here is our own wiring, and a
 * live API would only make those assertions slower and flakier without making them stronger.
 *
 * Findings are built through the real `parseFinding`, so a fixture that production's schema
 * would reject cannot make a test pass.
 */

export const SITE_ID = '11111111-1111-4111-8111-111111111111'
export const FINDING_ROW_ID = '22222222-2222-4222-8222-222222222222'
export const AUDIT_ID = '33333333-3333-4333-8333-333333333333'

export function aFinding(over: Partial<Finding> = {}): Finding {
  return parseFinding({
    id: 'TECH-005#0',
    siteId: SITE_ID,
    ruleId: 'TECH-005',
    axis: 'crawl_health',
    severity: 'critical',
    confidence: 1,
    title: 'The homepage is noindexed',
    evidence: {
      kind: 'markup',
      observedAt: '2026-08-20T00:00:00.000Z',
      source: 'crawler',
      url: 'https://example.com/',
      locator: 'head > meta[name="robots"]',
      snippet: '<meta name="robots" content="noindex">',
    },
    affectedUrls: ['https://example.com/', 'https://example.com/pricing'],
    estimatedEffort: 'trivial',
    estimatedImpact: 95,
    falsification: 'After the fix, the homepage still serves a noindex directive.',
    fixable: true,
    status: 'open',
    ...over,
  })
}

/** Records every call, so a test can assert what the tool actually asked the API for. */
export interface Recorder {
  calls: { method: string; args: unknown[] }[]
}

export function createFakeApi(overrides: Partial<ApiClient> = {}): {
  api: ApiClient
  recorder: Recorder
} {
  const recorder: Recorder = { calls: [] }

  const record =
    <T>(method: string, result: (...args: never[]) => T) =>
    (...args: never[]): T => {
      recorder.calls.push({ method, args })
      return result(...args)
    }

  const finding = aFinding()

  const base = {
    health: record('health', async () => ({ status: 'ok' })),

    listSites: record('listSites', async () => [
      {
        id: SITE_ID,
        url: 'https://example.com',
        repoFullName: 'acme/site',
        gscVerificationStatus: 'verified' as const,
        latestAudit: {
          id: AUDIT_ID,
          status: 'complete',
          pagesCrawled: 48,
          startedAt: '2026-08-20T00:00:00.000Z',
          scorecard: null,
        },
      },
    ]),

    listFindings: record('listFindings', async () => ({
      findings: [
        {
          rowId: FINDING_ROW_ID,
          siteId: SITE_ID,
          siteUrl: 'https://example.com',
          ruleId: 'TECH-005',
          axis: 'crawl_health' as const,
          severity: 'critical' as const,
          title: 'The homepage is noindexed',
          fixable: true,
          status: 'open' as const,
          estimatedImpact: 95,
          estimatedEffort: 'trivial' as const,
          affectedUrlCount: 2,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    })),

    getFinding: record('getFinding', async () => ({
      ...finding,
      rowId: FINDING_ROW_ID,
      auditId: AUDIT_ID,
    })),

    getAudit: record('getAudit', async () => ({
      id: AUDIT_ID,
      siteId: SITE_ID,
      siteUrl: 'https://example.com',
      status: 'complete',
      pagesCrawled: 48,
      startedAt: '2026-08-20T00:00:00.000Z',
      completedAt: '2026-08-20T00:04:00.000Z',
      error: null,
      scorecard: null,
      findings: [{ ...finding, rowId: FINDING_ROW_ID }],
    })),

    getAuditProgress: record('getAuditProgress', async () => ({
      id: AUDIT_ID,
      status: 'crawling',
      pagesCrawled: 12,
      finished: false,
    })),

    startAudit: record('startAudit', async () => AUDIT_ID),
    fixFinding: record('fixFinding', async () => ({ status: 'queued' })),
    verifySite: record('verifySite', async () => ({ status: 'queued' })),
  } as unknown as ApiClient

  return { api: { ...base, ...overrides }, recorder }
}
