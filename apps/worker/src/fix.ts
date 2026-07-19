import { getFinding } from '@seo/audit'
import { findings, sites, withTenant, type Database } from '@seo/db'
import { createFixerRegistry, detectFramework, type ReadRepoFile } from '@seo/fixers'
import type { FixJob } from '@seo/queue'
import { createGitHubApp, githubAppConfigFromEnv, GitHubProvider } from '@seo/vcs'
import { eq } from 'drizzle-orm'

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

export async function runFix(db: Database, job: FixJob): Promise<void> {
  const finding = await getFinding(db, job.tenantId, job.findingRowId)
  if (!finding) throw new Error(`Finding ${job.findingRowId} not found.`)
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

  const provider = new GitHubProvider(createGitHubApp(githubAppConfigFromEnv()).apiFor)
  const repo = { repo: { owner, name }, installationId: site.githubInstallationId }
  const read: ReadRepoFile = async (path) => (await provider.getFile(repo, path))?.content ?? null

  const framework = await detectFramework(read)
  const fix = await registry.generate({ finding, framework, read })
  if (!fix) {
    throw new Error(
      'No safe automatic fix could be generated for this finding. The code that produces the ' +
        'issue may be somewhere the fixer could not locate, or the case needs a human decision.',
    )
  }

  const pr = await provider.openPullRequest(repo, {
    // The finding's id is the rule key ('TECH-007#0'); the branch namespace needs it git-safe.
    finding: { ...finding, id: branchSafeId(finding.id) },
    files: fix.files,
    expectedEffect: fix.expectedEffect,
    rollback: fix.rollback,
  })

  await withTenant(db, job.tenantId, (tx) =>
    tx
      .update(findings)
      .set({ status: 'pr_open', prUrl: pr.url })
      .where(eq(findings.id, finding.rowId)),
  )
}

/** Make a finding key usable in a git branch: '#' and other stray characters become hyphens. */
function branchSafeId(id: string): string {
  return id.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'fix'
}
