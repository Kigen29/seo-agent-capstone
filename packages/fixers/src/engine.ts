import type { Finding, Framework } from '@seo/core'
import type { ReadRepoFile } from './framework/detect.js'

/**
 * The fixer engine: one place that turns a finding into a minimal set of file changes.
 *
 * A fixer is registered against the rule it fixes. Nothing here opens a pull request or talks
 * to GitHub; the engine only produces the diff, and the write path (@seo/vcs) applies it. That
 * separation is what lets a fixer be a pure function of a finding plus the repo, tested without
 * a network, and it is what keeps the deterministic-first law (ADR-0001) on the write side too:
 * a fixer edits structure it parsed, it does not guess.
 */

/** A whole-file change to write in the fix branch. Structurally the vcs FileChange. */
export interface FileChange {
  path: string
  content: string
}

/** Everything a fixer needs: the finding, the detected framework, and a way to read the repo. */
export interface FixContext {
  finding: Finding
  framework: Framework
  /** Read a current repo file, so a fixer edits existing content rather than clobbering it. */
  read: ReadRepoFile
}

/** What a fixer produces: the changes, and the two PR-body fields only the fixer can supply. */
export interface FixResult {
  files: FileChange[]
  /** What we expect to change if this works, in plain language, for the PR body. */
  expectedEffect: string
  /** How a human undoes this if it goes wrong, for the PR body. */
  rollback: string
}

export interface Fixer {
  /** The rule whose findings this fixer fixes, e.g. 'TECH-006'. */
  readonly ruleId: string
  /**
   * Whether this fixer can fix this specific finding. A rule can raise findings a fixer cannot
   * safely resolve (an ambiguous case, a framework it does not handle), and this is where it
   * says so rather than opening a bad PR.
   */
  canFix(finding: Finding): boolean
  /** Produce the fix, or null if a closer look shows there is nothing safe to change. */
  generate(ctx: FixContext): Promise<FixResult | null>
}

/**
 * The programmatic-page guardrail (CLAUDE.md rule 7).
 *
 * We never mass-produce doorway or location pages. A fix that would create a wall of new pages
 * is exactly the anti-pattern the rule forbids, so the engine warns as it approaches the line
 * and refuses to cross it, whatever the fixer intended.
 */
export const PAGE_CAP_WARN = 30
export const PAGE_CAP_STOP = 50

export class PageCapExceededError extends Error {
  constructor(count: number) {
    super(
      `Refusing to open a pull request that writes ${count} files (limit ${PAGE_CAP_STOP}). ` +
        'Mass-producing pages is banned (CLAUDE.md rule 7).',
    )
    this.name = 'PageCapExceededError'
  }
}

function enforcePageCap(files: FileChange[]): void {
  if (files.length > PAGE_CAP_STOP) throw new PageCapExceededError(files.length)
  if (files.length > PAGE_CAP_WARN) {
    console.warn(
      `A fix is writing ${files.length} files, approaching the ${PAGE_CAP_STOP}-file cap on ` +
        'programmatic pages (CLAUDE.md rule 7).',
    )
  }
}

/**
 * A registry of fixers, keyed by the rule they fix.
 *
 * Selection is by `ruleId` then `canFix`, so adding a fixer is a `register` call and never a
 * change to a dispatch switch. Framework differences live inside a fixer (via the head-strategy
 * families), not here: the registry's only job is to find the fixer that owns a finding.
 */
export class FixerRegistry {
  private readonly byRule = new Map<string, Fixer[]>()

  register(...fixers: Fixer[]): this {
    for (const fixer of fixers) {
      const list = this.byRule.get(fixer.ruleId) ?? []
      list.push(fixer)
      this.byRule.set(fixer.ruleId, list)
    }
    return this
  }

  /** The fixer that can fix this finding, or undefined. An unfixable finding always yields none. */
  fixerFor(finding: Finding): Fixer | undefined {
    if (!finding.fixable) return undefined
    return (this.byRule.get(finding.ruleId) ?? []).find((fixer) => fixer.canFix(finding))
  }

  /**
   * Generate a fix for a finding, or null when no fixer applies or the fix turns out empty.
   * Enforces the page cap before returning, so a runaway fixer is stopped at the engine, not at
   * the PR.
   */
  async generate(ctx: FixContext): Promise<FixResult | null> {
    const fixer = this.fixerFor(ctx.finding)
    if (!fixer) return null

    const result = await fixer.generate(ctx)
    if (!result || result.files.length === 0) return null

    enforcePageCap(result.files)
    return result
  }
}
