import type { Proposal, RepoFixLlm } from '@seo/agent'
import {
  asOwner,
  audits,
  createDb,
  findings,
  fixAttempts,
  sites,
  tenants,
  withTenant,
} from '@seo/db'
import type { VersionControlProvider } from '@seo/vcs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runFix } from '../../worker/src/fix.js'

/**
 * A finding with no hand-written fixer, fixed by the agent that reads the repository (ADR-0030).
 *
 * The real worker entry point against a real Postgres, with the two things that are not ours
 * faked: the repository and the model. What is under test is the path between them. That the
 * agent is asked only when nothing more constrained applies, that it is given the repository's
 * files and never its secrets, that a good proposal becomes a pull request with the edited files,
 * and that every kind of "no" lands on the finding as words the person who clicked can read.
 */
const { db, pool } = createDb(process.env.DATABASE_URL)
const SITE = 'https://agent-fix.example.com'
const PR_URL = 'https://github.com/octo/agent-fix/pull/5'

const REPO: Record<string, string> = {
  '.env': 'SUPER_SECRET=never-send-this',
  'index.html':
    '<!doctype html>\n<html lang="en">\n  <head>\n    <title>Agent Fix Example</title>\n' +
    `    <link rel="canonical" href="${SITE}/" />\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`,
  'package.json': JSON.stringify({ dependencies: { react: '18', 'react-helmet-async': '2' } }),
  'src/App.tsx': 'export default function App() {\n  return <Routes />\n}\n',
  'src/pages/About.tsx': 'export default function About() {\n  return <h1>About</h1>\n}\n',
}

let tenantId: string
let siteId: string
let findingId: string
let opened: { path: string; content: string }[] | null
let listed = 0
const prompts: string[] = []

const provider: VersionControlProvider = {
  findOpenPullRequest: async () => null,
  getFile: async (_ctx, path) => (path in REPO ? { content: REPO[path]!, sha: 'x' } : null),
  listFiles: async () => {
    listed += 1
    return Object.entries(REPO).map(([path, content]) => ({ path, size: content.length }))
  },
  openPullRequest: async (_ctx, input) => {
    opened = input.files
    return { number: 5, url: PR_URL, branch: 'seo-agent/agent-fix' }
  },
}

const answering = (answer: Proposal | Error): RepoFixLlm => ({
  async object(opts) {
    prompts.push(opts.prompt)
    if (answer instanceof Error) throw answer
    return { output: opts.schema.parse(answer) }
  },
})

const proposal = (over: Partial<Proposal>): Proposal => ({
  decision: 'fix',
  summary: 'Removed the static canonical from the HTML shell.',
  requestFiles: [],
  edits: [],
  newFiles: [],
  expectedEffect: 'Pages no longer all name the homepage as their canonical.',
  rollback: 'Revert the merge commit.',
  ...over,
})

const row = async () =>
  (
    await withTenant(db, tenantId, (tx) =>
      tx.select().from(findings).where(eq(findings.id, findingId)),
    )
  )[0]!

const fix = (llm: RepoFixLlm, requestId: string) =>
  runFix(db, { tenantId, siteId, findingRowId: findingId, requestId }, { provider, llm })

beforeAll(async () => {
  tenantId = await asOwner(
    db,
    async (tx) => (await tx.insert(tenants).values({ name: 'agent-fix' }).returning())[0]!.id,
  )
  await withTenant(db, tenantId, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        tenantId,
        url: `${SITE}/`,
        repoFullName: 'octo/agent-fix',
        githubInstallationId: 31,
      })
      .returning()
    siteId = site!.id
    const [audit] = await tx
      .insert(audits)
      .values({ tenantId, siteId, status: 'complete' })
      .returning()
    const [finding] = await tx
      .insert(findings)
      .values({
        tenantId,
        siteId,
        auditId: audit!.id,
        // A rule with no registered fixer: only the agent can attempt it.
        ruleId: 'TECH-023',
        key: 'TECH-023#0',
        axis: 'crawl_health',
        severity: 'critical',
        confidence: 0.95,
        title: `3 different pages all declare ${SITE}/ as their canonical`,
        evidence: {
          kind: 'markup',
          url: `${SITE}/about`,
          locator: 'link[rel="canonical"]',
          snippet: `<link rel="canonical" href="${SITE}/">`,
          observedAt: '2026-10-05T00:00:00.000Z',
          source: 'crawler',
        },
        affectedUrls: [`${SITE}/about`, `${SITE}/contact`, `${SITE}/tours`],
        estimatedEffort: 'small',
        estimatedImpact: 95,
        falsification: 'Re-fetch two of the pages; if each names its own URL, this was wrong.',
        fixable: true,
        status: 'open',
      })
      .returning()
    findingId = finding!.id
  })
})

beforeEach(async () => {
  opened = null
  listed = 0
  prompts.length = 0
  await withTenant(db, tenantId, async (tx) => {
    await tx.delete(fixAttempts).where(eq(fixAttempts.findingId, findingId))
    await tx
      .update(findings)
      .set({ status: 'open', prUrl: null, fixError: null })
      .where(eq(findings.id, findingId))
  })
})

afterAll(async () => {
  if (tenantId) await asOwner(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await pool.end()
})

describe('the agent fixing a finding that has no hand-written fixer', () => {
  it('reads the repository, and opens a pull request with exactly the edited file', async () => {
    const llm = answering(
      proposal({
        edits: [
          {
            path: 'index.html',
            find: `    <link rel="canonical" href="${SITE}/" />\n`,
            replace: '',
          },
        ],
      }),
    )

    await fix(llm, 'good')

    expect(listed).toBe(1)
    expect(opened).toEqual([
      {
        path: 'index.html',
        content: REPO['index.html']!.replace(`    <link rel="canonical" href="${SITE}/" />\n`, ''),
      },
    ])
    expect(await row()).toMatchObject({ status: 'pr_open', prUrl: PR_URL, fixError: null })
  })

  it('never shows the model an environment file', async () => {
    await fix(
      answering(proposal({ decision: 'cannot_fix', summary: 'Not enough to go on.' })),
      'secret',
    ).catch(() => {})

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('### index.html')
    expect(prompts[0]).not.toContain('never-send-this')
    expect(prompts[0]).not.toContain('SUPER_SECRET')
  })

  it("puts the model's reason on the finding when it decides not to change anything", async () => {
    const llm = answering(
      proposal({
        decision: 'cannot_fix',
        summary: 'The canonical is injected by the hosting platform and is not in any file here.',
      }),
    )

    await expect(fix(llm, 'declined')).rejects.toThrow(/injected by the hosting platform/)

    expect(opened).toBeNull()
    const after = await row()
    expect(after.status).toBe('open')
    expect(after.fixError).toContain('injected by the hosting platform')
    // The attempt is in the history with the same words.
    const attempts = await withTenant(db, tenantId, (tx) =>
      tx.select().from(fixAttempts).where(eq(fixAttempts.findingId, findingId)),
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ outcome: 'failed' })
    expect(attempts[0]!.error).toContain('injected by the hosting platform')
  })

  it('opens nothing when the proposal would edit a file the agent was never shown', async () => {
    const llm = answering(
      proposal({ edits: [{ path: '.env', find: 'SUPER_SECRET', replace: 'LEAKED' }] }),
    )

    await expect(fix(llm, 'unsafe')).rejects.toThrow(/not safe to open as a\s+pull request/)

    expect(opened).toBeNull()
    expect((await row()).fixError).toContain('a file it was not shown')
  })

  it('says the model could not be reached, in words, when it cannot', async () => {
    await expect(
      fix(answering(new Error('You have no credits remaining.')), 'down'),
    ).rejects.toThrow(/could not be reached/)

    expect(opened).toBeNull()
    expect((await row()).fixError).toContain('no credits remaining')
  })
})
