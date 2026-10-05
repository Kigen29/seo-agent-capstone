import type { Finding } from '@seo/core'

/**
 * Choosing what the agent reads from a client's repository, and what it must never read.
 *
 * The agent fixes a finding by reading the code that produces it (ADR-0030). A repository is far
 * larger than a model's attention is good for, and it contains things no model should be handed,
 * so the choice of files is made here, deterministically, before any model is involved:
 *
 *   1. `isReadable` decides what may be read at all. Environment files, keys, lockfiles, CI
 *      configuration, vendored and built code are refused by path, whatever else is true.
 *   2. `shortlist` ranks the readable files by how likely their *path* is to matter for this
 *      finding: the page files named after the affected URLs, the shared head and layout files,
 *      the router.
 *   3. `selectContext` reads the shortlist, withholds any file whose *contents* look like they
 *      carry a credential, ranks the rest by whether they contain what the finding observed (the
 *      duplicated title, the canonical URL), and fills a fixed budget.
 *
 * Every step is a pure function of the tree, the finding and the file contents. The same
 * repository and finding always produce the same context, which is what makes a bad fix
 * reproducible and the choice testable.
 */

export interface TreeEntry {
  path: string
  size: number
}

/** Files larger than this are not source a person edits by hand. */
export const MAX_FILE_BYTES = 80_000

/** How many files are read to be ranked, and how much of them the model is finally shown. */
export const SHORTLIST_SIZE = 60
export const CONTEXT_FILE_LIMIT = 14
export const CONTEXT_CHAR_BUDGET = 70_000

/** How many paths of the tree the model is shown, so it can ask for a file it was not given. */
export const TREE_PATH_LIMIT = 400

const READABLE_EXTENSIONS = new Set([
  'tsx',
  'jsx',
  'ts',
  'js',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'astro',
  'html',
  'htm',
  'md',
  'mdx',
  'txt',
  'xml',
  'toml',
  'liquid',
  'njk',
  'hbs',
  'php',
])

/** JSON is mostly data and lockfiles. Only these, which configure hosting and routing, are read. */
const READABLE_JSON = new Set([
  'vercel.json',
  'netlify.json',
  'firebase.json',
  'staticwebapp.config.json',
  'next-sitemap.config.json',
])

/**
 * Never read, never shown to a model, never written. Path-based and deliberately broad: a false
 * refusal costs one file of context, a false acceptance sends a secret to a third party.
 */
const FORBIDDEN_PATH = new RegExp(
  [
    '(^|/)\\.env($|[./-])', // .env, .env.local, .env.production
    '(^|/)\\.git(/|$)',
    '(^|/)\\.github/',
    '(^|/)\\.(vscode|idea|husky|circleci|gitlab|aws|ssh|gnupg)/',
    '(^|/)node_modules/',
    '(^|/)(dist|build|out|coverage|\\.next|\\.nuxt|\\.svelte-kit|\\.vercel|\\.netlify|\\.turbo|vendor)/',
    '(^|/)(secrets?|credentials?|private)(/|\\.|$)',
    '\\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc)$',
    '(^|/)\\.(npmrc|yarnrc|netrc|mcp\\.json|htpasswd)$',
    '(^|/)id_(rsa|dsa|ecdsa|ed25519)',
    '(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?|composer\\.lock)$',
    '(^|/)supabase/',
    '(^|/)(e2e|tests?|__tests__|__mocks__|cypress|playwright|k6|fixtures)/',
    '\\.(test|spec|stories|d)\\.[a-z]+$',
    '\\.min\\.(js|css)$',
  ].join('|'),
  'i',
)

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase()

/** May the agent read this file, and may a fix touch it? One answer for both. */
export function isReadable(entry: TreeEntry): boolean {
  if (FORBIDDEN_PATH.test(entry.path)) return false
  if (entry.size > MAX_FILE_BYTES) return false
  const extension = extensionOf(entry.path)
  if (extension === 'json') return READABLE_JSON.has(baseOf(entry.path))
  // Extensionless root files that configure a static host.
  if (extension === '') return ['_redirects', '_headers'].includes(baseOf(entry.path))
  return READABLE_EXTENSIONS.has(extension)
}

/**
 * Text that looks like it carries a credential. Checked on every file before it is shown to a
 * model, because a path cannot tell you that somebody pasted a key into `client.ts`.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, // a JWT
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/, // Stripe-style
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI-style
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub token
  /\bxox[abpr]-[A-Za-z0-9-]{20,}/, // Slack token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|secret|password|passwd|token|auth)\b\s*[:=]\s*['"`][A-Za-z0-9+/_=-]{24,}['"`]/i,
]

export function looksLikeItHoldsACredential(content: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(content))
}

/**
 * What each fixable rule is about, in the words likely to appear in the code that causes it.
 * Used only to rank files. A rule missing from here is still fixable; it just ranks on the
 * affected URLs and the shared files alone.
 */
const RULE_HINTS: Record<string, string[]> = {
  'TECH-001': ['robots', 'disallow', 'user-agent'],
  'TECH-006': ['canonical'],
  'TECH-011': ['<title', 'title=', 'document.title', 'helmet'],
  'TECH-016': ['hreflang', 'alternate'],
  'TECH-019': ['<h1'],
  'TECH-020': ['<h1', '<h2', '<h3', '<h4'],
  'TECH-021': ['description'],
  'TECH-023': ['canonical'],
  'TECH-024': ['<title', 'title=', 'document.title', 'helmet'],
  'TECH-025': ['<title', 'title=', 'document.title', 'helmet'],
  'TECH-026': ['description'],
  'TECH-027': ['description'],
  'TECH-028': ['<a ', '<link', 'href=', 'to='],
  'TECH-032': ['viewport'],
  'AGENT-002': ['<main', 'role="main"', 'layout'],
  'AGENT-003': ['<html', 'lang='],
  'AGENT-004': ['<img', 'alt='],
}

/** Shared files that set what every page's head and frame contain. */
const SHARED_FILE =
  /(^|\/)(index\.html?|app\.(tsx|jsx|vue|svelte)|_app\.(tsx|jsx)|_document\.(tsx|jsx)|layout\.(tsx|jsx|astro|svelte)|root\.(tsx|jsx)|main\.(tsx|jsx|ts|js)|router?\.(tsx|ts|jsx|js)|routes?\.(tsx|ts|jsx|js)|\+layout\.svelte|app\.html)$/i

const SEO_NAME = /(seo|head|meta|helmet|schema|structured|layout|header|footer|nav)/i

/** Rules that are about the crawl files themselves. Only then are those files worth reading first. */
const CRAWL_FILE_RULES = new Set(['TECH-001', 'TECH-003', 'TECH-004', 'TECH-005', 'TECH-016'])

/** The file a framework conventionally uses for the homepage. */
const HOME_FILE = /(^|\/)(index|home|homepage|landing)\.(tsx|jsx|vue|svelte|astro|mdx?)$/i

/** `/about/vision-mission` -> ['about', 'visionmission', 'vision', 'mission']. */
export function urlTokens(urls: readonly string[]): string[] {
  const tokens = new Set<string>()
  for (const url of urls) {
    let path: string
    try {
      path = decodeURIComponent(new URL(url).pathname)
    } catch {
      continue
    }
    for (const segment of path.split('/').filter(Boolean)) {
      // A uuid or a numeric id names a record, not a file.
      if (/^[0-9a-f-]{16,}$/i.test(segment) || /^\d+$/.test(segment)) continue
      const joined = segment.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (joined.length >= 3) tokens.add(joined)
      for (const part of segment.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 4) tokens.add(part)
      }
    }
  }
  return [...tokens]
}

/** How promising a path is for this finding, before anything is read. Higher is better. */
export function pathScore(path: string, finding: Pick<Finding, 'ruleId' | 'affectedUrls'>): number {
  const lower = path.toLowerCase()
  const squashed = lower.replace(/[^a-z0-9/]/g, '')
  let score = 0

  if (SHARED_FILE.test(path)) score += 60
  if (SEO_NAME.test(baseOf(path))) score += 45
  if (/(^|\/)(pages?|routes?|views?|app)\//.test(lower)) score += 15

  const crawlFile =
    /(^|\/)(robots\.txt|sitemap[^/]*\.xml|llms\.txt)$/.test(lower) ||
    /(^|\/)(vercel\.json|netlify\.toml|_redirects|_headers)$/.test(lower)
  if (crawlFile) score += CRAWL_FILE_RULES.has(finding.ruleId) ? 70 : 5

  // A finding about the homepage is usually caused in the homepage's own file.
  const aboutHome = finding.affectedUrls.slice(0, 12).some((url) => {
    try {
      return new URL(url).pathname.replace(/\/+$/, '') === ''
    } catch {
      return false
    }
  })
  if (aboutHome && HOME_FILE.test(path)) score += 45

  for (const token of urlTokens(finding.affectedUrls.slice(0, 12))) {
    if (squashed.includes(token)) score += 40
  }
  for (const hint of RULE_HINTS[finding.ruleId] ?? []) {
    const word = hint.replace(/[^a-z]/gi, '').toLowerCase()
    if (word.length >= 4 && lower.includes(word)) score += 25
  }

  // Generated component libraries: real code, almost never where an SEO issue lives.
  if (/(^|\/)components\/ui\//.test(lower)) score -= 50
  if (/(^|\/)(admin|dashboard)\//.test(lower)) score -= 25
  if (/(^|\/)(hooks|utils|lib|types|integrations|contexts?|store|services)\//.test(lower))
    score -= 15
  if (lower.endsWith('.md') && !lower.endsWith('.mdx')) score -= 20

  return score
}

/** The readable files worth opening for this finding, best first. Ties break by path. */
export function shortlist(
  tree: readonly TreeEntry[],
  finding: Pick<Finding, 'ruleId' | 'affectedUrls'>,
  limit: number = SHORTLIST_SIZE,
): string[] {
  return tree
    .filter(isReadable)
    .map((entry) => ({ path: entry.path, score: pathScore(entry.path, finding) }))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry.path)
}

/** Strings the finding observed on the live page, which the causing code probably contains. */
export function evidenceNeedles(finding: Finding): string[] {
  const needles = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return
    const text = value.trim()
    // Short strings match everywhere; very long ones never match source verbatim.
    if (text.length >= 12 && text.length <= 200) needles.add(text)
  }

  if (finding.subject) add(finding.subject)
  const evidence = finding.evidence as { snippet?: unknown }
  if (typeof evidence.snippet === 'string') {
    add(evidence.snippet)
    // The attribute values inside a tag are what appear in JSX; the tag itself rarely does.
    for (const match of evidence.snippet.matchAll(/(?:href|content|title|alt)="([^"]{12,200})"/g)) {
      add(match[1])
    }
  }
  return [...needles]
}

export interface ContextFile {
  path: string
  content: string
}

export interface SelectedContext {
  files: ContextFile[]
  /** Readable files that were not shown, so the model can ask for one by name. */
  otherPaths: string[]
  /** Files left out because their contents looked like they held a credential. */
  withheld: string[]
}

/**
 * Read the shortlist, rank by content, and fill the budget.
 *
 * Shared head and router files are always first, because nearly every fix needs to know how pages
 * are assembled. After them, files that contain what the finding observed outrank files that only
 * have a promising name.
 */
export async function selectContext(
  tree: readonly TreeEntry[],
  finding: Finding,
  read: (path: string) => Promise<string | null>,
  options: { also?: readonly string[] } = {},
): Promise<SelectedContext> {
  const readable = new Set(tree.filter(isReadable).map((entry) => entry.path))
  // Files the model asked for by name are read first, and only if they pass the same checks.
  const requested = (options.also ?? []).filter((path) => readable.has(path))
  const candidates = [...new Set([...requested, ...shortlist(tree, finding)])]

  const needles = evidenceNeedles(finding).map((needle) => needle.toLowerCase())
  const hints = (RULE_HINTS[finding.ruleId] ?? []).map((hint) => hint.toLowerCase())

  const loaded: { path: string; content: string; score: number }[] = []
  const withheld: string[] = []

  // In small batches: enough to be quick, few enough not to burst the host's API.
  for (let index = 0; index < candidates.length; index += 6) {
    const batch = candidates.slice(index, index + 6)
    const contents = await Promise.all(batch.map((path) => read(path).catch(() => null)))
    batch.forEach((path, offset) => {
      const content = contents[offset]
      if (content === null || content === undefined || content.length === 0) return
      if (looksLikeItHoldsACredential(content)) {
        withheld.push(path)
        return
      }
      const lower = content.toLowerCase()
      let score = pathScore(path, finding)
      if (requested.includes(path)) score += 500
      for (const needle of needles) if (lower.includes(needle)) score += 120
      for (const hint of hints) if (lower.includes(hint)) score += 20
      loaded.push({ path, content, score })
    })
  }

  loaded.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))

  const files: ContextFile[] = []
  let used = 0
  for (const file of loaded) {
    if (files.length >= CONTEXT_FILE_LIMIT) break
    if (used + file.content.length > CONTEXT_CHAR_BUDGET) continue
    files.push({ path: file.path, content: file.content })
    used += file.content.length
  }

  const shown = new Set(files.map((file) => file.path))
  const hidden = new Set(withheld)
  const otherPaths = [...readable]
    .filter((path) => !shown.has(path) && !hidden.has(path))
    .sort()
    .slice(0, TREE_PATH_LIMIT)

  return { files, otherPaths, withheld }
}
