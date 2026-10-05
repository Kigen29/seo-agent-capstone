import type { Finding } from '@seo/core'
import { LLM_FIXABLE_RULE_IDS } from '@seo/fixers'
import { describe, expect, it } from 'vitest'
import type { ContextFile, TreeEntry } from '../src/repo-context.js'
import {
  AGENT_FIXABLE_RULE_IDS,
  generateRepoFix,
  validateProposal,
  type Proposal,
  type RepoFixLlm,
} from '../src/repo-fix.js'

/**
 * The agent that reads a repository and writes the fix (ADR-0030).
 *
 * Almost nothing here tests the model, because the model is not ours to test. What is tested is
 * everything around it: that it is shown the right files and never the wrong ones, that it is
 * asked once (twice only if it asks to see more), and above all that what it returns cannot become
 * a pull request without passing `validateProposal`. Each refusal below is a way a confident,
 * well-formed, wrong answer would otherwise have reached a customer's repository.
 */

const INDEX_HTML =
  '<!doctype html>\n<html lang="en">\n  <head>\n    <title>Example Safaris</title>\n' +
  '    <link rel="canonical" href="https://www.example.com/" />\n  </head>\n' +
  '  <body>\n    <div id="root"></div>\n  </body>\n</html>\n'

const SEO_TSX =
  "import { Helmet } from 'react-helmet-async'\n\n" +
  'export function SEO({ title }: { title: string }) {\n' +
  '  return (\n    <Helmet>\n      <title>{title}</title>\n    </Helmet>\n  )\n}\n'

const ABOUT_TSX =
  "import { SEO } from '../components/SEO'\n\n" +
  'export default function About() {\n  return (\n    <>\n      <SEO title="About" />\n' +
  '      <h1>About Example Safaris</h1>\n    </>\n  )\n}\n'

const REPO: Record<string, string> = {
  'index.html': INDEX_HTML,
  'package.json': JSON.stringify({ dependencies: { react: '18', 'react-helmet-async': '2' } }),
  'src/App.tsx': 'export default function App() {\n  return <Routes />\n}\n',
  'src/components/SEO.tsx': SEO_TSX,
  'src/pages/About.tsx': ABOUT_TSX,
  'src/pages/Contact.tsx': 'export default function Contact() {\n  return <h1>Contact</h1>\n}\n',
  '.env': 'SECRET=do-not-read',
}
const TREE: TreeEntry[] = Object.entries(REPO).map(([path, content]) => ({
  path,
  size: content.length,
}))
const read = async (path: string) => REPO[path] ?? null

const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'TECH-023#0',
    siteId: 'site-1',
    ruleId: 'TECH-023',
    axis: 'crawl_health',
    severity: 'critical',
    confidence: 0.95,
    title: '2 different pages all declare https://www.example.com/ as their canonical',
    evidence: {
      kind: 'markup',
      url: 'https://www.example.com/about',
      locator: 'link[rel="canonical"]',
      snippet: '<link rel="canonical" href="https://www.example.com/">',
      observedAt: '2026-10-05T00:00:00.000Z',
      source: 'crawler',
    },
    affectedUrls: ['https://www.example.com/about', 'https://www.example.com/contact'],
    estimatedEffort: 'small',
    estimatedImpact: 95,
    falsification: 'Re-fetch two of the pages; if each names itself, this was wrong.',
    fixable: true,
    status: 'open',
    ...over,
  }) as Finding

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  decision: 'fix',
  summary: 'Removed the static canonical and made the SEO component emit one per route.',
  requestFiles: [],
  edits: [],
  newFiles: [],
  expectedEffect: 'Each page declares its own URL as canonical.',
  rollback: 'Revert the merge commit.',
  ...over,
})

/** Returns the queued answers in order and records every prompt it was sent. */
function fakeLlm(
  ...answers: (Proposal | Error)[]
): RepoFixLlm & { prompts: string[]; system: string[] } {
  const prompts: string[] = []
  const system: string[] = []
  return {
    prompts,
    system,
    async object(opts) {
      prompts.push(opts.prompt)
      system.push(opts.system ?? '')
      const next = answers.shift()
      if (!next) throw new Error('the fake model was asked more times than the test allowed')
      if (next instanceof Error) throw next
      return { output: opts.schema.parse(next) }
    },
  }
}

const REMOVE_STATIC_CANONICAL = {
  path: 'index.html',
  find: '    <link rel="canonical" href="https://www.example.com/" />\n',
  replace: '',
}
const ADD_ROUTE_CANONICAL = {
  path: 'src/components/SEO.tsx',
  find: '      <title>{title}</title>\n',
  replace:
    '      <title>{title}</title>\n' +
    '      <link rel="canonical" href={`https://www.example.com${window.location.pathname}`} />\n',
}

const run = (llm: RepoFixLlm, over: Partial<Finding> = {}) =>
  generateRepoFix(
    {
      finding: finding(over),
      framework: 'react_spa',
      siteUrl: 'https://www.example.com/',
      tree: TREE,
      read,
    },
    { llm, tenantId: 'tenant-1' },
  )

const shown: ContextFile[] = ['index.html', 'src/components/SEO.tsx', 'src/pages/About.tsx'].map(
  (path) => ({ path, content: REPO[path]! }),
)
const check = (over: Partial<Proposal>) =>
  validateProposal(proposal(over), shown, TREE, 'https://www.example.com/')

describe('the list of rules the agent may attempt', () => {
  it('is exactly what the fixer registry advertises, beside the one original content fix', () => {
    // Two packages hold this list because @seo/fixers must not depend on @seo/agent. If they
    // drift, the product offers a Fix button nothing answers, or hides one that works.
    expect([...LLM_FIXABLE_RULE_IDS].sort()).toEqual(['TECH-021', ...AGENT_FIXABLE_RULE_IDS].sort())
  })

  it('leaves out the rules that reading the code cannot settle', () => {
    for (const ruleId of [
      'TECH-001',
      'TECH-016',
      'AGENT-004',
      'TECH-013',
      'TECH-029',
      'TECH-031',
    ]) {
      expect(AGENT_FIXABLE_RULE_IDS).not.toContain(ruleId)
    }
  })
})

describe('generateRepoFix', () => {
  it('turns a valid proposal into whole-file changes, in one model call', async () => {
    const llm = fakeLlm(proposal({ edits: [REMOVE_STATIC_CANONICAL, ADD_ROUTE_CANONICAL] }))

    const outcome = await run(llm)

    expect(outcome.kind).toBe('fix')
    if (outcome.kind !== 'fix') return
    expect(llm.prompts).toHaveLength(1)
    const files = Object.fromEntries(outcome.fix.files.map((f) => [f.path, f.content]))
    expect(Object.keys(files).sort()).toEqual(['index.html', 'src/components/SEO.tsx'])
    expect(files['index.html']).not.toContain('rel="canonical"')
    expect(files['src/components/SEO.tsx']).toContain('window.location.pathname')
    // Everything else in the file is byte-for-byte what was there.
    expect(files['index.html']).toBe(INDEX_HTML.replace(REMOVE_STATIC_CANONICAL.find, ''))
    // The pull request says, in words, who wrote this and what was checked.
    expect(outcome.fix.expectedEffect).toMatch(
      /written by the agent's model after reading \d+ files/,
    )
  })

  it('shows the model the finding, the files, and never a file it may not read', async () => {
    const llm = fakeLlm(proposal({ decision: 'cannot_fix', summary: 'Not enough to go on.' }))

    await run(llm)

    const prompt = llm.prompts[0]!
    expect(prompt).toContain('# Finding TECH-023')
    expect(prompt).toContain('Re-fetch two of the pages')
    expect(prompt).toContain('### index.html')
    expect(prompt).toContain('react-helmet-async')
    expect(prompt).not.toContain('do-not-read')
    expect(prompt).not.toMatch(/^\.env$/m)
    // package.json is read for dependency names only; its contents are never offered for editing.
    expect(prompt).not.toContain('### package.json')
  })

  it('reads more files once when the model asks, and only ones it is allowed', async () => {
    const llm = fakeLlm(
      proposal({ decision: 'need_files', requestFiles: ['src/pages/Extra9.tsx', '.env'] }),
      proposal({ edits: [REMOVE_STATIC_CANONICAL] }),
    )
    // A repository too large to show whole, so there are files the model was not given.
    const outcome = await generateRepoFix(
      {
        finding: finding({ affectedUrls: ['https://www.example.com/about'] }),
        framework: 'react_spa',
        siteUrl: 'https://www.example.com/',
        tree: [
          ...TREE,
          ...Array.from({ length: 20 }, (_, i) => ({
            path: `src/pages/Extra${i}.tsx`,
            size: 9_000,
          })),
        ],
        read: async (path) => REPO[path] ?? (path.includes('Extra') ? 'x'.repeat(9_000) : null),
      },
      { llm, tenantId: 'tenant-1' },
    )

    expect(llm.prompts).toHaveLength(2)
    expect(llm.prompts[1]).not.toContain('do-not-read')
    expect(outcome.kind).toBe('fix')
  })

  it('stops after the second call, however many times the model asks for more', async () => {
    const more = proposal({ decision: 'need_files', requestFiles: ['src/pages/Extra9.tsx'] })
    const llm = fakeLlm(
      more,
      proposal({ decision: 'need_files', requestFiles: ['src/pages/Extra8.tsx'] }),
    )

    const outcome = await generateRepoFix(
      {
        finding: finding({ affectedUrls: ['https://www.example.com/about'] }),
        framework: 'react_spa',
        siteUrl: 'https://www.example.com/',
        tree: [
          ...TREE,
          ...Array.from({ length: 20 }, (_, i) => ({
            path: `src/pages/Extra${i}.tsx`,
            size: 9_000,
          })),
        ],
        read: async (path) => REPO[path] ?? (path.includes('Extra') ? 'x'.repeat(9_000) : null),
      },
      { llm, tenantId: 'tenant-1' },
    )

    expect(llm.prompts).toHaveLength(2)
    expect(outcome).toMatchObject({ kind: 'declined' })
    if (outcome.kind === 'declined') expect(outcome.reason).toMatch(/still could not locate/)
  })

  it('declines without a second call when the model asks only for files it may not read', async () => {
    const llm = fakeLlm(
      proposal({ decision: 'need_files', requestFiles: ['.env', '../../etc/passwd'] }),
    )

    const outcome = await run(llm)

    expect(llm.prompts).toHaveLength(1)
    expect(outcome.kind).toBe('declined')
  })

  it("passes on the model's own reason when it decides not to change anything", async () => {
    const llm = fakeLlm(
      proposal({
        decision: 'cannot_fix',
        summary:
          'The canonical is set by the hosting platform, not by any file in this repository.',
      }),
    )

    const outcome = await run(llm)

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain('set by the hosting platform')
      expect(outcome.reason).toMatch(/read \d+ files/)
    }
  })

  it('declines, and says nothing was changed, when the proposal fails validation', async () => {
    const llm = fakeLlm(
      proposal({
        edits: [{ path: 'src/App.tsx', find: 'this text is not in the file', replace: 'x' }],
      }),
    )

    const outcome = await run(llm)

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain("did not match the file's contents")
      expect(outcome.reason).toContain('Nothing was changed')
    }
  })

  it('declines with a reason when the model cannot be reached, rather than throwing', async () => {
    const outcome = await run(fakeLlm(new Error('You have no credits remaining.\n    at stack')))

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain('no credits remaining')
      expect(outcome.reason).not.toContain('at stack')
    }
  })

  it('does not touch a rule it has no business with, and makes no call', async () => {
    const llm = fakeLlm()

    expect(await run(llm, { ruleId: 'TECH-013' })).toEqual({ kind: 'not_applicable' })
    expect(llm.prompts).toEqual([])
  })

  it('says so when it cannot list the repository at all', async () => {
    const llm = fakeLlm()
    const outcome = await generateRepoFix(
      {
        finding: finding(),
        framework: 'react_spa',
        siteUrl: 'https://www.example.com/',
        tree: [],
        read,
      },
      { llm, tenantId: 'tenant-1' },
    )

    expect(outcome).toMatchObject({ kind: 'declined' })
    expect(llm.prompts).toEqual([])
  })

  it('pins the prompt, because it is production code that happens to be prose', async () => {
    const llm = fakeLlm(proposal({ decision: 'cannot_fix', summary: 'n/a' }))

    await run(llm)

    expect(llm.system[0]).toMatchSnapshot('system')
    expect(llm.prompts[0]).toMatchSnapshot('prompt')
  })
})

describe('validateProposal: what a model-written change must pass before it is a pull request', () => {
  it('accepts an exact, unique edit to a file that was shown', () => {
    const verdict = check({ edits: [REMOVE_STATIC_CANONICAL] })

    expect(verdict.ok).toBe(true)
  })

  it.each([
    [
      'an edit to a file it was not shown',
      { edits: [{ path: 'src/App.tsx', find: 'Routes', replace: 'Router' }] },
      /not shown/,
    ],
    [
      'an edit to a file that does not exist',
      { edits: [{ path: 'src/Nope.tsx', find: 'a', replace: 'b' }] },
      /not shown/,
    ],
    [
      'text that is not in the file',
      { edits: [{ path: 'index.html', find: '<meta charset>', replace: '' }] },
      /did not match/,
    ],
    [
      'text that appears more than once',
      { edits: [{ path: 'index.html', find: '<', replace: '[' }] },
      /more than one place/,
    ],
    [
      'an edit that changes nothing',
      { edits: [{ path: 'index.html', find: '<title>', replace: '<title>' }] },
      /changed nothing/,
    ],
    [
      'an empty find',
      { edits: [{ path: 'index.html', find: '', replace: 'x' }] },
      /nothing to find/,
    ],
    ['no change at all', {}, /no change/],
  ])('refuses %s', (_label, over, reason) => {
    const verdict = check(over as Partial<Proposal>)

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(reason)
  })

  it.each([
    ['.env.production', /does not write/],
    ['.github/workflows/deploy.yml', /does not write/],
    ['tsconfig.json', /does not write/],
    ['package.json', /already exists/],
    ['src/integrations/supabase/client.ts', /does not write/],
    ['../outside.ts', /outside the repository/],
    ['scripts/postinstall.js', /outside the places/],
    ['index.html', /already exists/],
  ])('refuses to create %s', (path, reason) => {
    const verdict = check({ newFiles: [{ path, content: 'anything' }] })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(reason)
  })

  it('allows a new file where a fix may add one', () => {
    const verdict = check({
      newFiles: [
        { path: 'src/components/Canonical.tsx', content: 'export const Canonical = () => null\n' },
      ],
    })

    expect(verdict.ok).toBe(true)
  })

  it('refuses a link to a site the repository never mentioned', () => {
    const verdict = check({
      edits: [
        {
          path: 'src/pages/About.tsx',
          find: '<h1>About Example Safaris</h1>',
          replace:
            '<h1>About Example Safaris</h1><a href="https://best-safari-deals.example/">Partners</a>',
        },
      ],
    })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('best-safari-deals.example')
  })

  it("allows the site's own address and schema.org", () => {
    const verdict = check({
      edits: [
        {
          path: 'src/pages/About.tsx',
          find: '<h1>About Example Safaris</h1>',
          replace:
            '<h1>About Example Safaris</h1><link rel="canonical" href="https://www.example.com/about" />' +
            '<meta itemType="https://schema.org/AboutPage" />',
        },
      ],
    })

    expect(verdict.ok).toBe(true)
  })

  it('refuses a change that deletes most of a file', () => {
    // Every line distinct, so the span being deleted occurs exactly once.
    const lines = Array.from({ length: 80 }, (_, i) => `const value${i} = ${i}`)
    const long = { path: 'src/pages/Long.tsx', content: `${lines.join('\n')}\n` }
    const doomed = `${lines.slice(1).join('\n')}\n`
    const verdict = validateProposal(
      proposal({ edits: [{ path: long.path, find: doomed, replace: '' }] }),
      [long],
      [...TREE, { path: long.path, size: long.content.length }],
      'https://www.example.com/',
    )

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('more than half')
  })

  it('refuses a change that touches more files than one fix should', () => {
    const many: ContextFile[] = Array.from({ length: 9 }, (_, i) => ({
      path: `src/pages/P${i}.tsx`,
      content: `export const title${i} = 'Old title ${i}'\n`,
    }))
    const verdict = validateProposal(
      proposal({
        edits: many.map((f, i) => ({
          path: f.path,
          find: `Old title ${i}`,
          replace: `New title ${i}`,
        })),
      }),
      many,
      many.map((f) => ({ path: f.path, size: f.content.length })),
      'https://www.example.com/',
    )

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('more than the 8 allowed')
  })

  it('removes em dashes the model introduced, and leaves ones already in the code', () => {
    const verdict = check({
      edits: [
        {
          path: 'src/pages/About.tsx',
          find: '<SEO title="About" />',
          replace: '<SEO title="About us — Example Safaris" />',
        },
      ],
    })

    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.files[0]!.content).toContain('title="About us, Example Safaris"')
      expect(verdict.files[0]!.content).not.toContain('—')
    }
  })

  it('applies several edits to one file in order, each against the result of the last', () => {
    const verdict = check({
      edits: [
        {
          path: 'src/pages/About.tsx',
          find: '<SEO title="About" />',
          replace: '<SEO title="About us" />',
        },
        {
          path: 'src/pages/About.tsx',
          find: '<h1>About Example Safaris</h1>',
          replace: '<h1>About us</h1>',
        },
      ],
    })

    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.files).toHaveLength(1)
      expect(verdict.files[0]!.content).toContain('<SEO title="About us" />')
      expect(verdict.files[0]!.content).toContain('<h1>About us</h1>')
    }
  })
})

/**
 * A model's request limit depends on the provider and the plan, and a free plan can be a quarter
 * of what the full context needs. A refusal for size is not an answer, so the agent tries again
 * with less instead of reporting a failure the person cannot act on.
 */
describe('generateRepoFix: when the provider says the request is too large', () => {
  const TOO_LARGE = new Error(
    'Every target in the chain for role "smart" failed:\n' +
      '  - groq:big -> Request too large for model `big` on tokens per minute (TPM): Limit 8000, Requested 19211\n' +
      '  - groq:small -> Request too large for model `small` on tokens per minute (TPM): Limit 8000, Requested 19211',
  )
  const WIDE: Record<string, string> = {
    ...REPO,
    ...Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `src/pages/Page${i}.tsx`,
        `export default function Page${i}() {\n  return <h1>Page ${i}</h1>\n}\n` +
          '// pad\n'.repeat(400),
      ]),
    ),
  }
  const wideTree: TreeEntry[] = Object.entries(WIDE).map(([path, content]) => ({
    path,
    size: content.length,
  }))
  let fetched: string[] = []
  const runWide = (llm: RepoFixLlm) => {
    fetched = []
    return generateRepoFix(
      {
        finding: finding(),
        framework: 'react_spa',
        siteUrl: 'https://www.example.com/',
        tree: wideTree,
        read: async (path) => {
          fetched.push(path)
          return WIDE[path] ?? null
        },
      },
      { llm, tenantId: 'tenant-1' },
    )
  }

  it('asks again with fewer files, and the fix still opens', async () => {
    const llm = fakeLlm(TOO_LARGE, proposal({ edits: [REMOVE_STATIC_CANONICAL] }))

    const outcome = await runWide(llm)

    expect(outcome.kind).toBe('fix')
    expect(llm.prompts).toHaveLength(2)
    expect(llm.prompts[1]!.length).toBeLessThan(llm.prompts[0]!.length / 2)
    // The file that holds the evidence survives the cut.
    expect(llm.prompts[1]).toContain('### index.html')
  })

  it('steps down twice before giving up, and never fetches a file a second time', async () => {
    const llm = fakeLlm(TOO_LARGE, TOO_LARGE, proposal({ edits: [REMOVE_STATIC_CANONICAL] }))

    const outcome = await runWide(llm)

    expect(outcome.kind).toBe('fix')
    expect(llm.prompts).toHaveLength(3)
    expect(llm.prompts[2]!.length).toBeLessThan(15_000)
    expect(new Set(fetched).size).toBe(fetched.length)
  })

  it('says the files are too large for the model when even the smallest request is refused', async () => {
    const llm = fakeLlm(TOO_LARGE, TOO_LARGE, TOO_LARGE)

    const outcome = await runWide(llm)

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain('larger than the configured model accepts')
      expect(outcome.reason).toContain('Limit 8000')
    }
    expect(llm.prompts).toHaveLength(3)
  })

  it('still allows one request for more files after stepping down', async () => {
    const llm = fakeLlm(
      TOO_LARGE,
      proposal({ decision: 'need_files', requestFiles: ['src/pages/Page29.tsx'] }),
      proposal({ edits: [REMOVE_STATIC_CANONICAL] }),
    )

    const outcome = await runWide(llm)

    expect(outcome.kind).toBe('fix')
    expect(llm.prompts[2]).toContain('### src/pages/Page29.tsx')
  })

  it('does not retry an error that has nothing to do with size', async () => {
    const llm = fakeLlm(new Error('Invalid API Key'))

    const outcome = await runWide(llm)

    expect(outcome.kind).toBe('declined')
    expect(llm.prompts).toHaveLength(1)
  })
})

describe('generateRepoFix: the reason shown when every model in the chain failed', () => {
  it("is the provider's own words, not the header that says the chain failed", async () => {
    const outcome = await run(
      fakeLlm(
        new Error(
          'Every target in the chain for role "smart" failed:\n' +
            '  - groq:a -> 429 rate limit\n' +
            '  - groq:b -> The model is decommissioned.\n    at stack',
        ),
      ),
    )

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain('groq:b -> The model is decommissioned.')
      expect(outcome.reason).not.toContain('Every target')
      expect(outcome.reason).not.toContain('at stack')
    }
  })
})

describe('generateRepoFix: an honest reason when the model limit is what stopped it', () => {
  const TOO_LARGE = new Error('Request too large: Limit 8000, Requested 19211')

  it('says the limit cut what it could show, and what would change that', async () => {
    const outcome = await run(
      fakeLlm(
        TOO_LARGE,
        proposal({ decision: 'cannot_fix', summary: 'The page file is not shown.' }),
      ),
    )

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') {
      expect(outcome.reason).toContain('The page file is not shown.')
      expect(outcome.reason).toContain('accepts only small requests')
      expect(outcome.reason).toContain('larger request limit')
    }
  })

  it('does not mention a limit when none was hit', async () => {
    const outcome = await run(
      fakeLlm(proposal({ decision: 'cannot_fix', summary: 'Not in code.' })),
    )

    expect(outcome.kind).toBe('declined')
    if (outcome.kind === 'declined') expect(outcome.reason).not.toContain('small requests')
  })
})
