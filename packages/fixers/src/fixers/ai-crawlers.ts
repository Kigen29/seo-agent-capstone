import type { Finding } from '@seo/core'
import type { FileChange, FixContext, Fixer, FixResult } from '../engine.js'

/**
 * TECH-002: robots.txt blocks the AI search crawlers that make a site citable in ChatGPT and
 * Perplexity.
 *
 * The fix edits the site's robots.txt so each blocked search agent is allowed. It is deliberately
 * minimal and conservative, because a careless robots edit can deindex a whole site:
 *
 *   - When a group already names the agent and disallows the root, that one `Disallow: /` becomes
 *     `Allow: /`. Nothing else in the file is touched.
 *   - When the agent is only caught by a blanket `User-agent: *` block, an explicit allow group is
 *     appended. A named group is more specific than `*`, so it wins for that agent, and appending
 *     never rewrites a line a human wrote.
 *
 * It only edits robots.txt as a file. A framework that generates robots from code (a Next.js
 * `robots.ts`) is not something to rewrite blindly, so the fixer returns null and a human handles
 * it. The blocked agents come from the finding's own evidence, which the rule already computed, so
 * the fixer re-derives nothing and can never disagree with the finding it is fixing.
 */
export class UnblockAiCrawlersFixer implements Fixer {
  readonly ruleId = 'TECH-002'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'TECH-002' && blockedTokensFrom(finding).length > 0
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    const tokens = blockedTokensFrom(ctx.finding)
    if (tokens.length === 0) return null

    let path: string | null = null
    let content: string | null = null
    for (const candidate of ROBOTS_FILES) {
      const found = await ctx.read(candidate)
      if (found !== null) {
        path = candidate
        content = found
        break
      }
    }
    if (path === null || content === null) return null

    const next = allowAgents(content, tokens)
    if (next === content) return null

    const files: FileChange[] = [{ path, content: next }]
    const list = tokens.join(', ')
    return {
      files,
      expectedEffect:
        `robots.txt now allows ${list}, so the search crawlers behind ChatGPT and Perplexity can ` +
        'read the site and cite it. The change is verifiable in robots.txt immediately; recovery ' +
        'of real citations takes weeks of re-crawling and is never guaranteed.',
      rollback: `Revert the merge commit; robots.txt returns to blocking ${list} exactly as before.`,
    }
  }
}

/** Where a static robots.txt lives, most conventional first. A code-generated route is not here. */
const ROBOTS_FILES = ['public/robots.txt', 'robots.txt', 'static/robots.txt', 'src/robots.txt']

/**
 * The blocked agent tokens, read from the finding's evidence.
 *
 * The rule records each blocked agent as a line `Disallowed: <token> (<operator>). ...` in the
 * evidence snippet. Reading the tokens from there keeps the fixer in lockstep with the finding
 * rather than re-implementing robots evaluation and risking a different answer.
 */
function blockedTokensFrom(finding: Finding): string[] {
  if (finding.evidence.kind !== 'markup') return []
  const tokens: string[] = []
  for (const line of finding.evidence.snippet.split('\n')) {
    const match = line.match(/^\s*Disallowed:\s*(\S+)\s*\(/)
    if (match) tokens.push(match[1]!)
  }
  return tokens
}

/**
 * Allow each agent in robots.txt, editing an existing named block or appending an allow group.
 *
 * Line-based on purpose: regenerating the file from a parse would reformat it and lose comments and
 * ordering, so a reviewer could not see at a glance that only the block was lifted. This walks the
 * groups, keeps every other line byte-for-byte, and changes the one line that matters.
 */
function allowAgents(text: string, tokens: string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)

  for (const token of tokens) {
    const group = findAgentGroup(lines, token)
    if (group) {
      // The agent has its own group. Flip a root Disallow to Allow, in place.
      const disallowIdx = group.ruleLines.find((i) => isRootDisallow(lines[i]!))
      if (disallowIdx !== undefined) {
        lines[disallowIdx] = lines[disallowIdx]!.replace(/Disallow/i, 'Allow')
        continue
      }
      // Named but not root-disallowed here: nothing safe to flip, leave it.
      continue
    }

    // Only caught by `*`: append a specific allow group, which outranks the wildcard for this agent.
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') lines.push('')
    lines.push(`User-agent: ${token}`, 'Allow: /')
  }

  return lines.join(eol)
}

interface AgentGroup {
  /** Indices of the rule lines (Disallow/Allow/etc.) that belong to this agent's group. */
  ruleLines: number[]
}

/**
 * The group that names `token`, if any. A group is a run of consecutive `User-agent` lines followed
 * by rule lines, up to the next `User-agent` line. Matching is case-insensitive and exact on the
 * token (`OAI-SearchBot`, not `*`).
 */
function findAgentGroup(lines: string[], token: string): AgentGroup | null {
  const wanted = token.toLowerCase()
  let i = 0
  while (i < lines.length) {
    const ua = userAgentOf(lines[i]!)
    if (ua === null) {
      i += 1
      continue
    }

    // Collect the consecutive User-agent lines that head this group.
    const agents: string[] = []
    while (i < lines.length) {
      const name = userAgentOf(lines[i]!)
      if (name === null) break
      agents.push(name.toLowerCase())
      i += 1
    }

    // Then the rule lines, until the next User-agent line.
    const ruleLines: number[] = []
    while (i < lines.length && userAgentOf(lines[i]!) === null) {
      if (lines[i]!.trim() !== '' && !lines[i]!.trim().startsWith('#')) ruleLines.push(i)
      i += 1
    }

    if (agents.includes(wanted)) return { ruleLines }
  }
  return null
}

/** The user-agent named on a line, or null if the line is not a `User-agent:` directive. */
function userAgentOf(line: string): string | null {
  const match = line.match(/^\s*User-agent\s*:\s*(\S+)/i)
  return match ? match[1]! : null
}

/** Whether a line disallows the whole site: `Disallow: /`. An empty Disallow allows everything. */
function isRootDisallow(line: string): boolean {
  return /^\s*Disallow\s*:\s*\/\s*(#.*)?$/i.test(line)
}
