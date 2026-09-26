import { generateContentFix } from '@seo/agent'
import { baselineFor, getFinding } from '@seo/audit'
import { findings, fixAttempts, sites, withTenant, type Database } from '@seo/db'
import { createFixerRegistry, detectFramework, type ReadRepoFile } from '@seo/fixers'
import type { FixJob } from '@seo/queue'
import {
  createGitHubApp,
  githubAppConfigFromEnv,
  GitHubProvider,
  type PullRequest,
  type VersionControlProvider,
} from '@seo/vcs'
import { and, eq } from 'drizzle-orm'
import { createWorkerLlm } from './llm.js'

/**
 * Open a pull request that fixes one finding.
 *
 * This is the composition root for the loop's last step: it resolves the finding and the site's
 * connected repo into a live GitHub provider, detects the framework from the repo, asks the fixer
 * engine for a diff, opens the PR, and records it on the finding so the dashboard can link to it.
 * Everything upstream of the provider is a pure function of the finding and the repo (ADR-0001 on
 * the write side); the only side effects are reading the repo and opening the PR.
 *
 * A throw fails the job, which the drain records and retries; a finding that turns out not to be
 * fixable, a missing repo, or a fixer that cannot locate the source each throw a message a human
 * can act on rather than a stack trace.
 */
const registry = createFixerRegistry()

/** Seams for tests. Production builds the GitHub provider from the environment. */
export interface FixDeps {
  provider?: VersionControlProvider
}

/** What one attempt achieved, recorded in fix_attempts. Null when there was nothing to do. */
type AttemptResult = { outcome: 'pr_opened' | 'pr_adopted'; prUrl: string } | null

export async function runFix(db: Database, job: FixJob, deps: FixDeps = {}): Promise<void> {
  const startedAt = new Date()
  try {
    const result = await attemptFix(db, job, deps)
    // A delivery for a finding that is no longer open did nothing, and is not an attempt.
    if (result) {
      await recordAttempt(db, job, startedAt, result).catch((writeError: unknown) => {
        console.error('fix: could not record the attempt:', writeError)
      })
    }
  } catch (error) {
    /**
     * Write the reason onto the finding before rethrowing.
     *
     * The rethrow still matters: it fails the job, which the drain records and retries, and a
     * silent failure would be a different bug. What was missing is that the person who clicked
     * the button had no way to learn any of this. The dashboard told them a pull request was on
     * its way and then nothing happened, because the only record of the failure was a line in a
     * GitHub Actions log.
     *
     * Best-effort, and it must not mask the original error: if we cannot even write the reason
     * down, the useful thing to surface is still what actually went wrong.
     */
    await recordFixFailure(db, job, error, startedAt).catch((writeError: unknown) => {
      console.error('fix: could not record why the fix failed:', writeError)
    })
    throw error
  }
}

/**
 * Store the reason on the finding so the inbox and the finding page can show it, and keep the
 * failed attempt in the history. One transaction, so the latest error and the history never disagree.
 */
async function recordFixFailure(
  db: Database,
  job: FixJob,
  error: unknown,
  startedAt: Date,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)

  await withTenant(db, job.tenantId, async (tx) => {
    await tx.update(findings).set({ fixError: message }).where(eq(findings.id, job.findingRowId))
    await tx.insert(fixAttempts).values({
      tenantId: job.tenantId,
      findingId: job.findingRowId,
      requestId: job.requestId ?? null,
      startedAt,
      outcome: 'failed',
      error: message.slice(0, 2000),
    })
  })
}

/** A successful attempt: a pull request opened, or one a crashed attempt had opened, reused. */
async function recordAttempt(
  db: Database,
  job: FixJob,
  startedAt: Date,
  result: NonNullable<AttemptResult>,
): Promise<void> {
  await withTenant(db, job.tenantId, (tx) =>
    tx.insert(fixAttempts).values({
      tenantId: job.tenantId,
      findingId: job.findingRowId,
      requestId: job.requestId ?? null,
      startedAt,
      outcome: result.outcome,
      prUrl: result.prUrl,
    }),
  )
}

async function attemptFix(db: Database, job: FixJob, deps: FixDeps): Promise<AttemptResult> {
  const finding = await getFinding(db, job.tenantId, job.findingRowId)
  if (!finding) throw new Error(`Finding ${job.findingRowId} not found.`)
  // A delayed delivery must not regenerate a PR or move a merged finding backwards.
  if (finding.status !== 'open') return null
  if (!finding.fixable) throw new Error('This finding is not fixable in code.')

  const site = await withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx.select().from(sites).where(eq(sites.id, finding.siteId)).limit(1)
    return row
  })
  if (!site) throw new Error(`Site ${finding.siteId} not found.`)
  if (!site.repoFullName || !site.githubInstallationId) {
    throw new Error('This site has no connected repository, so there is nowhere to open the PR.')
  }

  const [owner, name] = site.repoFullName.split('/')
  if (!owner || !name) throw new Error(`Malformed connected repo name: ${site.repoFullName}`)

  const provider =
    deps.provider ?? new GitHubProvider(createGitHubApp(githubAppConfigFromEnv()).apiFor)
  const repo = { repo: { owner, name }, installationId: site.githubInstallationId }
  const branchId = branchSafeId(finding.rowId)

  // A previous attempt may have opened the PR and then died before recording it. Adopt that PR
  // instead of regenerating the fix, so a crash costs neither a second model call nor a second PR.
  const existing = await provider.findOpenPullRequest(repo, branchId)
  if (existing) {
    await recordPullRequest(db, job.tenantId, finding, existing)
    return { outcome: 'pr_adopted', prUrl: existing.url }
  }

  // Built per job rather than once at module load, because the client now carries the budget
  // guard and the guard needs the database handle the job was called with. It is a couple of
  // closures over an existing pool; the cost is nothing next to the crawl this sits behind.
  const llm = createWorkerLlm(db)
  const read: ReadRepoFile = async (path) => (await provider.getFile(repo, path))?.content ?? null

  const framework = await detectFramework(read)

  // Deterministic first (ADR-0001): a registered fixer transforms structure it parsed. Only when
  // none applies does the LLM content fixer get a turn, and it makes exactly one schema-validated
  // call for text and nothing more. If the LLM chain is unconfigured it returns null, and this
  // falls through to the honest "no fix" error rather than opening an empty PR.
  const fix =
    (await registry.generate({ finding, framework, read })) ??
    (await generateContentFix(
      { finding, framework, read, siteUrl: site.url },
      { llm, tenantId: job.tenantId },
    ))
  if (!fix) {
    throw new Error(
      'No safe automatic fix could be generated for this finding. The code that produces the ' +
        'issue may be somewhere the fixer could not locate, or the case needs a human decision.',
    )
  }

  const pr = await provider.openPullRequest(repo, {
    // Use the persisted observation ID, not the positional rule key shared by other audits.
    finding: { ...finding, id: branchId },
    files: fix.files,
    expectedEffect: fix.expectedEffect,
    rollback: fix.rollback,
  })

  await recordPullRequest(db, job.tenantId, finding, pr)
  return { outcome: 'pr_opened', prUrl: pr.url }
}

async function recordPullRequest(
  db: Database,
  tenantId: string,
  finding: { rowId: string; ruleId: string; affectedUrls: string[] },
  pr: PullRequest,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(findings)
      // `fixError` is cleared, not left behind: it describes the most recent attempt, and a stale
      // failure sitting next to an open pull request would read as though the PR had failed.
      // The baseline is what "did it work?" is later measured against: every page the rule
      // flagged, failing, at the moment the fix was proposed.
      .set({ status: 'pr_open', prUrl: pr.url, fixError: null, baseline: baselineFor(finding) })
      // Only an open finding moves to pr_open; a webhook may already have recorded a merge.
      .where(and(eq(findings.id, finding.rowId), eq(findings.status, 'open'))),
  )
}

/** Make a finding key usable in a git branch: '#' and other stray characters become hyphens. */
function branchSafeId(id: string): string {
  return id.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'fix'
}
