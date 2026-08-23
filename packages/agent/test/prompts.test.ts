import type { Finding } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { generateContentFix, type ContentLlm } from '../src/content-fix.js'
import { draftOutreach, type OutreachLlm } from '../src/outreach.js'

/**
 * The prompts, pinned.
 *
 * A prompt is production code that happens to be prose, and it is the one kind of production code
 * that can be rewritten in a hurry with no test to notice. Deleting "no invented specifics such as
 * prices, awards, or ratings" from the content-fix system message compiles, passes every existing
 * test (they assert the mechanism: one call, schema-validated, a graceful null) and changes what
 * the product writes into a customer's repository. This makes that edit visible in a diff, which
 * is where a change of that kind should be argued about.
 *
 * Snapshotting what is *sent* rather than a builder function is deliberate. The prompts are
 * assembled inline from conditional fragments, so a snapshot of the assembled string covers the
 * branches too. Extracting a builder to test would create a second thing that could drift from
 * the first.
 *
 * When one of these fails: read the diff. If the change was intended, `vitest -u` and let the
 * reviewer see the prose move. If it was not, that is the test doing its job.
 */

const descriptionFinding = (): Finding =>
  ({
    id: 'TECH-021#0',
    siteId: 'site-1',
    ruleId: 'TECH-021',
    axis: 'content',
    severity: 'low',
    confidence: 1,
    title: 'https://ex.com/ has no meta description',
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'meta[name="description"]',
      snippet: '',
      observedAt: '2026-07-19T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls: ['https://ex.com/'],
    estimatedEffort: 'trivial',
    estimatedImpact: 30,
    falsification: 'A re-crawl still finds no meta description on the homepage.',
    fixable: true,
    status: 'open',
  }) as Finding

const INDEX_HTML =
  '<!doctype html>\n<html>\n  <head>\n    <title>Ex Safaris</title>\n  </head>\n  <body></body>\n</html>\n'

/** Records the call and returns something the schema accepts, so the caller runs to completion. */
function recorder<
  T extends { system?: string; prompt: string; schema: { parse: (v: unknown) => unknown } },
>(value: unknown): { sent: T[]; object: (opts: T) => Promise<{ output: unknown }> } {
  const sent: T[] = []
  return {
    sent,
    async object(opts: T) {
      sent.push(opts)
      return { output: opts.schema.parse(value) }
    },
  }
}

describe('the content-fix prompt', () => {
  it('is sent verbatim', async () => {
    const llm = recorder({ description: 'Ex Safaris runs small-group wildlife safaris in Kenya.' })

    await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: async (path: string) => (path === 'index.html' ? INDEX_HTML : null),
        siteUrl: 'https://ex.com',
      },
      { llm: llm as unknown as ContentLlm, tenantId: 'tenant-1' },
    )

    expect(llm.sent).toHaveLength(1)
    expect(llm.sent[0]!.system).toMatchSnapshot('system')
    expect(llm.sent[0]!.prompt).toMatchSnapshot('prompt')
  })

  it('drops the title line when the head has no title, rather than sending an empty one', async () => {
    // The branch, pinned separately. A prompt that says "Page title:" with nothing after it is an
    // invitation to invent one, and it is exactly the sort of thing a refactor smooths over.
    const llm = recorder({ description: 'A page about safaris in Kenya, run by Ex Safaris.' })

    await generateContentFix(
      {
        finding: descriptionFinding(),
        framework: 'react_spa',
        read: async () => '<!doctype html>\n<html>\n  <head></head>\n  <body></body>\n</html>\n',
        siteUrl: 'https://ex.com',
      },
      { llm: llm as unknown as ContentLlm, tenantId: 'tenant-1' },
    )

    expect(llm.sent[0]!.prompt).not.toContain('Page title:')
    expect(llm.sent[0]!.prompt).toMatchSnapshot('prompt without a title')
  })
})

describe('the outreach prompt', () => {
  it('is sent verbatim, and carries only the facts it was given', async () => {
    const llm = recorder({
      subject: 'Kenyan safari pricing data',
      body: 'Hello,\n\nWe published median pricing across 40 operators.\n\nThanks',
      angle: 'They cover East African travel pricing.',
    })

    await draftOutreach(
      {
        brand: 'Ex Safaris',
        siteUrl: 'https://ex.com',
        target: { domain: 'travelweekly.example', context: 'A piece on safari pricing' },
        facts: [
          {
            claim: 'Median 7-day safari price across 40 Kenyan operators is $2,410',
            sourceUrl: 'https://ex.com/data',
          },
          { claim: '', sourceUrl: 'https://ex.com/ignored' },
        ],
      },
      { llm: llm as unknown as OutreachLlm, tenantId: 'tenant-1' },
    )

    expect(llm.sent).toHaveLength(1)
    // The blank claim must not reach the model. An empty bullet under "the only facts you may use"
    // reads as permission to fill it in, which is the failure mode this whole prompt guards.
    expect(llm.sent[0]!.prompt).not.toContain('- (source: https://ex.com/ignored)')
    expect(llm.sent[0]!.system).toMatchSnapshot('system')
    expect(llm.sent[0]!.prompt).toMatchSnapshot('prompt')
  })
})
