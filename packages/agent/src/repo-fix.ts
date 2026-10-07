import type { Finding, Framework } from '@seo/core'
import type { FixResult } from '@seo/fixers'
import { z } from 'zod'
import {
  isReadable,
  CONTEXT_SIZES,
  fitContext,
  rankCandidates,
  type ContextFile,
  type SelectedContext,
  type TreeEntry,
} from './repo-context.js'

/**
 * The agent that reads a repository and writes the fix (ADR-0030).
 *
 * A deterministic rule found the issue, as always (ADR-0001). What changes here is who writes the
 * fix. Ten rules have a hand-written transformation; the rest that live in a client's code had
 * nothing, so most of an audit was advice. For those, the model is shown the finding, the files
 * that most plausibly cause it, and the list of the files it was not shown, and it returns edits.
 *
 * It is trusted with the writing and with nothing else:
 *
 *   - It never decides what is wrong. The finding and its evidence come from the rule engine.
 *   - It never chooses what to read unsupervised. `repo-context.ts` decides what is readable and
 *     withholds anything that looks like a credential; a file the model asks for by name goes
 *     through the same checks.
 *   - It returns structure, not prose: exact find-and-replace edits and new files, validated by a
 *     schema, then by `validateProposal`, which is ordinary code. An edit to a file it was not
 *     shown, a `find` that is not there exactly once, a forbidden path, a new dependency, a link
 *     to a host nobody mentioned: each is refused, and the refusal is the answer the person sees.
 *   - It writes to a branch behind a pull request, like every other fix (rule 2). A person reads
 *     the diff before anything reaches the site, and the merged fix is re-crawled and verified.
 *
 * At most two model calls per finding: one to propose, and one more only if the model says it
 * needs files it was not given. Both go through the tenant's budget guard. A request a provider
 * refuses as too large is retried with fewer files, down two sizes, before the agent gives up.
 */

/** The smallest slice of the LLM client this needs. `@seo/llm`'s LlmClient satisfies it. */
export interface RepoFixLlm {
  object<T>(opts: {
    role: 'smart'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
    maxTokens?: number
  }): Promise<{ output: T }>
}

/**
 * No length limits and no optional fields, on purpose. Strict structured-output modes reject
 * both, and a schema a provider refuses fails before the model runs. Every limit is enforced in
 * `validateProposal` instead, where a refusal can say what was wrong.
 */
export const proposalSchema = z.object({
  decision: z.enum(['fix', 'need_files', 'cannot_fix']),
  /** What was changed and why, or why nothing could be. Shown to the person, so plain words. */
  summary: z.string(),
  /** With `need_files`: paths from the list of files not shown. */
  requestFiles: z.array(z.string()),
  edits: z.array(z.object({ path: z.string(), find: z.string(), replace: z.string() })),
  newFiles: z.array(z.object({ path: z.string(), content: z.string() })),
  expectedEffect: z.string(),
  rollback: z.string(),
})
export type Proposal = z.infer<typeof proposalSchema>

/**
 * Rules the agent may attempt. `@seo/fixers` mirrors this list; a test keeps the two equal.
 *
 * Reading the code is not enough to fix everything, and three rules that look fixable are left
 * out on purpose. TECH-001 (robots.txt blocks a page the sitemap lists): only the owner knows
 * which of the two is right, and picking wrong removes a page from Google. TECH-016 (a one-way
 * hreflang): the missing half may be in another repository. AGENT-004 (images with no alt text):
 * the model cannot see the picture, so what it wrote would be a guess from a file name.
 */
export const AGENT_FIXABLE_RULE_IDS: readonly string[] = [
  'TECH-006',
  'TECH-011',
  'TECH-019',
  'TECH-020',
  'TECH-023',
  'TECH-024',
  'TECH-025',
  'TECH-026',
  'TECH-027',
  'TECH-028',
  'TECH-032',
  'AGENT-002',
  'AGENT-003',
]

/**
 * What a correct fix looks like, per rule. Deterministic text, written by a person who knows the
 * rule, so the model is told the acceptance condition rather than left to infer it from a title.
 */
const RULE_GUIDANCE: Record<string, string> = {
  'TECH-006':
    'Each affected page needs a canonical link pointing at its own URL. If pages share one head component, add the canonical there, derived from the current route, not hard-coded per page.',
  'TECH-011':
    'Each listed page must render its own title describing that page. Find where the title is set (a shared default, a head component, or the static HTML) and give each page a specific one. Keep the site name as a suffix if it is already used that way.',
  'TECH-019':
    'Each affected page must have exactly one h1 that names the page. If there is none, promote the element that already serves as the page heading. If there are several, keep the main one and demote the others to h2. Do not change the visible text.',
  'TECH-020':
    'A heading level is skipped (for example h1 then h3). Change the heading elements so levels descend one at a time. Preserve the visual styling by keeping existing class names.',
  'TECH-023':
    'Many pages declare the same canonical URL, so each claims to be a copy of one page. Every page must declare its own URL. Usually one static tag in the HTML shell or a default value in a shared head component is the cause: make it derive from the current route, and remove any static tag that would otherwise win.',
  'TECH-024':
    'The affected pages render no title. Give each one a specific title where the framework expects it.',
  'TECH-025':
    'The titles are longer than about 60 characters and will be cut off in search results. Shorten each to under 60 characters while keeping what the page is about. Prefer shortening a shared suffix or template once over editing every page.',
  'TECH-026':
    'The affected pages have no meta description. Add one per page, 70 to 160 characters, stating plainly what the page offers, based only on what the page source already says.',
  'TECH-027':
    'Several pages share one meta description, usually a static tag in the HTML shell or a default in a shared head component. Give each page its own, 70 to 160 characters, based only on what that page source already says, and make sure the shared default no longer overrides it.',
  'TECH-028':
    'Internal links use text such as "click here" or "read more". Replace the link text with words that describe the destination, taken from the surrounding content. Do not change where the link goes.',
  'TECH-032':
    'The page has no responsive viewport. Add <meta name="viewport" content="width=device-width, initial-scale=1"> in the document head, or correct the existing tag.',
  'AGENT-002':
    'Pages have no main landmark. Wrap the primary content in a <main> element in the shared layout, once, without changing styling: carry existing class names over if a wrapper element is being replaced.',
  'AGENT-003':
    'The html element declares no language. Add the lang attribute for the language the site is written in.',
}

const SYSTEM_PROMPT = [
  'You fix one SEO finding in a website repository by proposing exact edits to its files.',
  'A deterministic audit found the issue; your job is only to write the smallest change that resolves it.',
  '',
  'Rules:',
  '1. Edit only files whose full contents you were shown. To see another file from the list of other files, return decision "need_files" with up to 6 paths, and nothing else.',
  '2. Each edit is an exact find-and-replace. "find" must be copied character for character from the file as shown, must occur exactly once in that file, and should be the shortest unique span that contains the change. Include neighbouring lines if needed to make it unique.',
  '3. Change as little as possible. Do not reformat, rename, reorder imports, or tidy code you were not asked to fix. Match the existing style.',
  '4. Use only libraries the project already depends on. Never add a dependency or edit package.json.',
  '5. Never invent facts. No made-up prices, awards, ratings, addresses, names, statistics or reviews. Text you write must be supported by what the repository already says.',
  '6. Do not add links to websites that are not already referenced in the files you were shown.',
  '7. Do not use the em dash character in anything you write.',
  '8. If the fix needs information that is not in the repository, a decision only the owner can make, or a change outside the code (hosting settings, content only the business can supply), return decision "cannot_fix" and say plainly what is needed.',
  '9. If you are not confident an edit is correct, return "cannot_fix". A wrong pull request is worse than none.',
  '',
  'In "summary", say in two or three plain sentences what you changed and why it resolves the finding. In "expectedEffect", say what will be different on the live site. In "rollback", say how to undo it. Always return every field; use empty arrays and empty strings where a field does not apply.',
].join('\n')

/** How much of each list the prompt carries. Enough to see the pattern, bounded for cost. */
const MAX_URLS_IN_PROMPT = 20

export function buildRepoFixPrompt(input: {
  finding: Finding
  framework: Framework
  siteUrl: string
  dependencies: readonly string[]
  context: SelectedContext
}): string {
  const { finding, context } = input
  const urls = finding.affectedUrls.slice(0, MAX_URLS_IN_PROMPT)
  const more = finding.affectedUrls.length - urls.length

  const sections = [
    `# Finding ${finding.ruleId}`,
    finding.title,
    '',
    `Site: ${input.siteUrl}`,
    `Framework: ${input.framework}`,
    '',
    '## What a correct fix looks like',
    RULE_GUIDANCE[finding.ruleId] ?? 'Resolve the finding as described, with the smallest change.',
    '',
    '## How we will know the fix failed',
    finding.falsification,
    '',
    '## What the audit observed',
    JSON.stringify(finding.evidence),
    '',
    `## Affected pages (${finding.affectedUrls.length})`,
    ...urls.map((url) => `- ${url}`),
    ...(more > 0 ? [`- and ${more} more`] : []),
    '',
    '## Libraries the project already depends on',
    input.dependencies.length > 0 ? input.dependencies.join(', ') : '(none listed)',
    '',
    '## Files you may edit, shown in full',
    ...context.files.flatMap((file) => [
      `### ${file.path}`,
      '<<<FILE',
      file.content,
      'FILE>>>',
      '',
    ]),
    '## Other files in the repository (not shown; request up to 6 with "need_files")',
    context.otherPaths.length > 0 ? context.otherPaths.join('\n') : '(none)',
  ]
  return sections.join('\n')
}

export const MAX_FILES_CHANGED = 8
export const MAX_EDITS = 30
export const MAX_CHANGE_CHARS = 30_000
export const MAX_NEW_FILE_CHARS = 20_000

/** Where a fix may create a file. Everywhere else, a fix edits what exists. */
const NEW_FILE_LOCATION = /^(public|static|src|app|pages|components|layouts|content)\//i
const NEW_ROOT_FILES = new Set(['vercel.json', 'netlify.toml', '_redirects', '_headers'])

/** Hosts a fix may mention without their already being in the repository. */
const ALWAYS_ALLOWED_HOSTS = new Set(['schema.org', 'www.w3.org', 'w3.org'])

const hostsIn = (text: string): Set<string> => {
  const hosts = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    hosts.add(match[1]!.toLowerCase().replace(/^www\./, ''))
  }
  return hosts
}

/** Rule 10: no em dashes in prose we generate. Applied to text the model wrote, never to code. */
const withoutEmDashes = (text: string): string =>
  text.replace(/\s*—\s*/g, ', ').replace(/\s*–\s*/g, ', ')

export type ProposalVerdict =
  { ok: true; files: { path: string; content: string }[] } | { ok: false; reason: string }

/**
 * Turn a model's proposal into file contents, or refuse it and say why.
 *
 * This is the leash. Everything here is ordinary code over strings, so every refusal is
 * reproducible and testable, and none of it depends on the model being well behaved.
 */
export function validateProposal(
  proposal: Proposal,
  shown: readonly ContextFile[],
  tree: readonly TreeEntry[],
  siteUrl: string,
): ProposalVerdict {
  const refuse = (reason: string): ProposalVerdict => ({ ok: false, reason })

  if (proposal.edits.length === 0 && proposal.newFiles.length === 0) {
    return refuse('it proposed no change')
  }
  if (proposal.edits.length > MAX_EDITS) {
    return refuse(`it proposed ${proposal.edits.length} edits, more than the ${MAX_EDITS} allowed`)
  }

  const original = new Map(shown.map((file) => [file.path, file.content]))
  const working = new Map(original)
  const existing = new Set(tree.map((entry) => entry.path))

  for (const edit of proposal.edits) {
    const current = working.get(edit.path)
    if (current === undefined) {
      return refuse(`it tried to edit ${edit.path}, a file it was not shown`)
    }
    if (edit.find.length === 0) return refuse(`an edit to ${edit.path} had nothing to find`)
    if (edit.find === edit.replace) return refuse(`an edit to ${edit.path} changed nothing`)

    const first = current.indexOf(edit.find)
    if (first === -1) {
      return refuse(`an edit to ${edit.path} did not match the file's contents`)
    }
    if (current.indexOf(edit.find, first + 1) !== -1) {
      return refuse(`an edit to ${edit.path} matched in more than one place, so it is ambiguous`)
    }
    // Only strip em dashes the model introduced. Ones already in the code are not ours to change.
    const replacement = /[—]/.test(edit.find) ? edit.replace : withoutEmDashes(edit.replace)
    working.set(
      edit.path,
      current.slice(0, first) + replacement + current.slice(first + edit.find.length),
    )
  }

  const created = new Map<string, string>()
  for (const file of proposal.newFiles) {
    const path = file.path.replace(/^\.?\/+/, '')
    if (path.includes('..')) return refuse(`it tried to create a file outside the repository`)
    if (existing.has(path) || created.has(path)) {
      return refuse(`it tried to create ${path}, which already exists`)
    }
    // The same check that decides what may be read decides what may be written.
    if (!isReadable({ path, size: file.content.length })) {
      return refuse(`it tried to create ${path}, a kind of file the agent does not write`)
    }
    if (!NEW_FILE_LOCATION.test(path) && !NEW_ROOT_FILES.has(path)) {
      return refuse(`it tried to create ${path}, outside the places a fix may add files`)
    }
    if (file.content.length > MAX_NEW_FILE_CHARS) {
      return refuse(
        `it tried to create ${path} at ${file.content.length} characters, which is too large`,
      )
    }
    created.set(path, withoutEmDashes(file.content))
  }

  const changed = [...working].filter(([path, content]) => content !== original.get(path))
  const files = [
    ...changed.map(([path, content]) => ({ path, content })),
    ...[...created].map(([path, content]) => ({ path, content })),
  ]
  if (files.length === 0) return refuse('its edits cancelled out and changed nothing')
  if (files.length > MAX_FILES_CHANGED) {
    return refuse(
      `it changed ${files.length} files, more than the ${MAX_FILES_CHANGED} allowed in one fix`,
    )
  }

  const written =
    proposal.edits.reduce((sum, edit) => sum + edit.replace.length, 0) +
    proposal.newFiles.reduce((sum, file) => sum + file.content.length, 0)
  if (written > MAX_CHANGE_CHARS) {
    return refuse(`it wrote ${written} characters, more than one fix should change`)
  }

  for (const [path, content] of changed) {
    const before = original.get(path)!
    // A fix that deletes most of a file is not the smallest change that resolves a finding.
    if (before.length > 400 && content.length < before.length * 0.5) {
      return refuse(`it removed more than half of ${path}`)
    }
  }

  // No new destinations. A link the repository never mentioned is where invention shows up.
  const known = hostsIn(shown.map((file) => file.content).join('\n'))
  for (const host of hostsIn(siteUrl)) known.add(host)
  const introduced = hostsIn(
    [
      ...proposal.edits.map((edit) => edit.replace),
      ...proposal.newFiles.map((file) => file.content),
    ].join('\n'),
  )
  for (const host of introduced) {
    if (!known.has(host) && !ALWAYS_ALLOWED_HOSTS.has(host)) {
      return refuse(`it added a link to ${host}, which appears nowhere in the files it read`)
    }
  }

  // Dependencies are never a fix's to add: an import of a package nobody installed breaks the build.
  for (const edit of proposal.edits) {
    if (/(^|\/)package\.json$/.test(edit.path)) return refuse('it tried to edit package.json')
  }

  return { ok: true, files }
}

export interface RepoFixInput {
  finding: Finding
  framework: Framework
  siteUrl: string
  tree: readonly TreeEntry[]
  read: (path: string) => Promise<string | null>
}

export interface RepoFixDeps {
  llm: RepoFixLlm
  tenantId: string
  /** How a wait is spent. Injected so a test does not sleep for a minute. */
  sleep?: (ms: number) => Promise<void>
}

export type RepoFixOutcome =
  | { kind: 'fix'; fix: FixResult; filesRead: number }
  | { kind: 'declined'; reason: string; filesRead: number }
  | { kind: 'not_applicable' }

/** Names only. The model needs to know `react-helmet-async` is there, not which version. */
async function dependencyNames(read: RepoFixInput['read']): Promise<string[]> {
  try {
    const raw = await read('package.json')
    if (!raw) return []
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .sort()
      .slice(0, 120)
  } catch {
    return []
  }
}

/**
 * The line of an error worth showing. When every model in a chain failed, the first line only
 * says that they did and the reasons follow one per line, so the last of those is the useful one.
 */
function errorLine(error: unknown): string {
  const lines = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)
  const attempts = lines.filter((line) => /^\s*-\s.+->/.test(line))
  const chosen = attempts[attempts.length - 1] ?? lines[0] ?? 'unknown error'
  return chosen
    .replace(/^\s*-\s*/, '')
    .trim()
    .slice(0, 300)
}

/** A provider refusing the request for its size, as opposed to failing for any other reason. */
const TOO_LARGE =
  /too large|\b413\b|context.?length|context window|maximum context|reduce (your|the) (message|prompt|input)/i

/**
 * A provider saying "not now", as opposed to "not this". The request is fine and the minute's
 * allowance is spent, or the model is busy. Several fixes asked for at once reach this on a small
 * plan as a matter of course, since each one is most of a minute's tokens.
 */
const NOT_NOW = /rate limit|\b429\b|try again in|high demand|try again later|overloaded/i

/** How long to wait before asking again, and how many times. Bounded so a job cannot hang. */
const MAX_WAITS = 2
const DEFAULT_WAIT_MS = 30_000
const LONGEST_WAIT_MS = 65_000

/** "Please try again in 12.3s" or "in 1m4s": what the provider asked for, plus a margin. */
export function waitFor(message: string): number {
  const asked = /try again in\s+(?:(\d+)m(?!s))?\s*(\d+(?:\.\d+)?)?\s*(ms|s)?/i.exec(message)
  if (!asked || (asked[1] === undefined && asked[2] === undefined)) return DEFAULT_WAIT_MS

  const minutes = Number(asked[1] ?? 0)
  const amount = Number(asked[2] ?? 0)
  const ms = minutes * 60_000 + (asked[3] === 'ms' ? amount : amount * 1000)
  return Math.min(LONGEST_WAIT_MS, Math.ceil(ms) + 2_000)
}

/** The smallest size leaves less room for the answer too: both count against the same limit. */
const outputTokensFor = (size: number): number => (size === CONTEXT_SIZES.length - 1 ? 3000 : 4096)

/**
 * Read the repository and propose a fix for one finding.
 *
 * Never throws for an ordinary "no": a model that declines, a proposal that fails validation, and
 * a model that cannot be reached are all `declined`, with a reason fit to show the person who
 * clicked the button (ADR-0022: a fix that could not be made has to say so).
 */
export async function generateRepoFix(
  input: RepoFixInput,
  deps: RepoFixDeps,
): Promise<RepoFixOutcome> {
  const { finding } = input
  if (!AGENT_FIXABLE_RULE_IDS.includes(finding.ruleId)) return { kind: 'not_applicable' }
  if (input.tree.length === 0) {
    return {
      kind: 'declined',
      reason: 'The agent could not list the files in this repository.',
      filesRead: 0,
    }
  }

  // Each file is fetched once however many times the context is rebuilt.
  const cache = new Map<string, Promise<string | null>>()
  const read = (path: string): Promise<string | null> => {
    let hit = cache.get(path)
    if (!hit) {
      hit = input.read(path).catch(() => null)
      cache.set(path, hit)
    }
    return hit
  }

  const dependencies = await dependencyNames(read)
  let ranked = await rankCandidates(input.tree, finding, read)
  let size = 0
  let context = fitContext(ranked, CONTEXT_SIZES[size])
  if (context.files.length === 0) {
    return {
      kind: 'declined',
      reason: 'The agent found no source files in this repository that it is able to read.',
      filesRead: 0,
    }
  }

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let waits = 0
  let proposal: Proposal | undefined
  // Two answers at most: a proposal, and one more if the model asked to see other files. A request
  // a provider refused for its size was never answered, so trying again smaller is not a third.
  for (let round = 0; round < 2;) {
    try {
      const result = await deps.llm.object({
        role: 'smart',
        tenantId: deps.tenantId,
        schema: proposalSchema,
        system: SYSTEM_PROMPT,
        maxTokens: outputTokensFor(size),
        prompt: buildRepoFixPrompt({
          finding,
          framework: input.framework,
          siteUrl: input.siteUrl,
          // The dependency list is the first thing to give way when room is short.
          dependencies: size === 0 ? dependencies : dependencies.slice(0, 40),
          context,
        }),
      })
      proposal = result.output
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Every target's own words, for the operator. The finding shows one line; the log is where
      // "which model said what" has to be answerable after the fact.
      console.warn(
        `agent: model call failed for ${finding.ruleId} at context size ${size + 1} of ${CONTEXT_SIZES.length}: ` +
          message.replace(/\s+/g, ' ').slice(0, 900),
      )
      const smaller =
        size + 1 < CONTEXT_SIZES.length ? fitContext(ranked, CONTEXT_SIZES[size + 1]) : null
      if (TOO_LARGE.test(message) && smaller && smaller.files.length > 0) {
        size += 1
        context = smaller
        continue
      }
      // Too large is answered by asking for less. Not now is answered by asking again later, at
      // the same size: nothing about the request was wrong.
      if (!TOO_LARGE.test(message) && NOT_NOW.test(message) && waits < MAX_WAITS) {
        waits += 1
        const ms = waitFor(message)
        console.warn(`agent: waiting ${Math.round(ms / 1000)}s before asking again`)
        await sleep(ms)
        continue
      }
      return {
        kind: 'declined',
        reason: TOO_LARGE.test(message)
          ? `The files behind this finding are larger than the configured model accepts in one request, even at the smallest size the agent can work with (${errorLine(error)}).`
          : `The agent's model could not be reached or did not answer usefully (${errorLine(error)}).`,
        filesRead: context.files.length,
      }
    }

    round += 1
    if (proposal.decision !== 'need_files' || round === 2) break

    const wanted = proposal.requestFiles.slice(0, 6)
    const known = new Set(context.otherPaths)
    const allowed = wanted.filter((path) => known.has(path))
    if (allowed.length === 0) {
      return {
        kind: 'declined',
        reason:
          'The agent asked to read files that do not exist or that it is not allowed to read, ' +
          'so it could not locate where this issue comes from.',
        filesRead: context.files.length,
      }
    }
    ranked = await rankCandidates(input.tree, finding, read, { also: allowed })
    context = fitContext(ranked, CONTEXT_SIZES[size])
  }

  const filesRead = context.files.length
  if (!proposal) return { kind: 'declined', reason: 'The agent produced no answer.', filesRead }

  const summary = withoutEmDashes(proposal.summary).trim()
  // When the provider's limit cut what could be shown, that is the reason, and it is one the
  // operator can act on. Saying only "could not locate it" would blame the repository.
  const cramped =
    size > 0
      ? ` The configured model accepts only small requests, so the agent could show it ${filesRead} short files and not the longer ones. A model with a larger request limit could attempt this.`
      : ''
  if (proposal.decision === 'need_files') {
    return {
      kind: 'declined',
      reason: `After reading ${filesRead} files the agent still could not locate where this issue comes from.${cramped}`,
      filesRead,
    }
  }
  if (proposal.decision === 'cannot_fix') {
    return {
      kind: 'declined',
      reason: `The agent read ${filesRead} files and decided not to change anything: ${summary || 'it gave no reason.'}${cramped}`,
      filesRead,
    }
  }

  const verdict = validateProposal(proposal, context.files, input.tree, input.siteUrl)
  if (!verdict.ok) {
    return {
      kind: 'declined',
      reason:
        `The agent read ${filesRead} files and proposed a change, but it was not safe to open as a ` +
        `pull request: ${verdict.reason}. Nothing was changed. Trying again may produce a usable fix.`,
      filesRead,
    }
  }

  const effect = withoutEmDashes(proposal.expectedEffect).trim()
  const rollback = withoutEmDashes(proposal.rollback).trim()
  return {
    kind: 'fix',
    filesRead,
    fix: {
      files: verdict.files,
      expectedEffect:
        `${summary} ${effect}`.trim() +
        ` This change was written by the agent's model after reading ${filesRead} files of this ` +
        'repository, and checked mechanically before the pull request was opened: it edits only ' +
        'files it was shown, adds no dependency and no new external link. Read the diff as you ' +
        "would a colleague's.",
      rollback:
        rollback.length > 0
          ? rollback
          : 'Revert the merge commit. The change is confined to the files in this pull request.',
    },
  }
}
