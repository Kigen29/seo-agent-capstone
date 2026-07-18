import { branchNameFor, branchPrefixFor } from '../branch.js'
import { buildPrBody, buildPrTitle } from '../pr-body.js'
import type {
  FixPullRequest,
  PullRequest,
  RepoContext,
  RepoFile,
  VersionControlProvider,
} from '../provider.js'

/**
 * The minimal GitHub REST surface the provider needs. `github/client.ts` adapts Octokit to
 * this, and it is the only place a vendor SDK is imported (the same discipline ADR-0005 uses
 * for the LLM layer). Because the provider talks to this interface and not to Octokit, its
 * whole behaviour, including the rule-2 and rule-4 guarantees, is testable with a fake and no
 * network.
 *
 * Note what is not here: no `push`, no `commitToBranch(anyBranch)`, no `updateDefaultBranch`.
 * The surface only lets you read, create a fresh branch, write onto a branch you just created,
 * and open a PR. Writing to the default branch is not a capability this interface grants.
 */
export interface GitHubApi {
  getDefaultBranch(): Promise<string>
  getBranchHeadSha(branch: string): Promise<string>
  getFile(path: string, ref: string): Promise<RepoFile | null>
  createBranch(branch: string, fromSha: string): Promise<void>
  putFile(input: {
    branch: string
    path: string
    content: string
    message: string
    sha?: string
  }): Promise<void>
  createPullRequest(input: {
    head: string
    base: string
    title: string
    body: string
  }): Promise<{ url: string; number: number }>
  findOpenPullRequestByHeadPrefix(
    prefix: string,
  ): Promise<{ url: string; number: number; branch: string } | null>
}

/** Given a repo context, produce a REST client scoped to that installation and repository. */
export type GitHubApiFactory = (ctx: RepoContext) => GitHubApi | Promise<GitHubApi>

/**
 * Opens pull requests on GitHub, and only pull requests.
 *
 * The order of operations in `openPullRequest` is deliberate: the PR body is built first, so
 * that a finding missing its falsification or a caller missing a rollback note fails before
 * any branch or commit exists. Then idempotency is checked, so a retried job does not open a
 * second PR. Only then is a branch created and written to. There is no path in this method
 * that writes to the base branch.
 */
export class GitHubProvider implements VersionControlProvider {
  constructor(private readonly apiFor: GitHubApiFactory) {}

  async getFile(ctx: RepoContext, path: string, ref?: string): Promise<RepoFile | null> {
    const api = await this.apiFor(ctx)
    const branch = ref ?? (await api.getDefaultBranch())
    return api.getFile(path, branch)
  }

  async findOpenPullRequest(ctx: RepoContext, findingId: string): Promise<PullRequest | null> {
    const api = await this.apiFor(ctx)
    return api.findOpenPullRequestByHeadPrefix(branchPrefixFor(findingId))
  }

  async openPullRequest(ctx: RepoContext, input: FixPullRequest): Promise<PullRequest> {
    const api = await this.apiFor(ctx)

    // Build the body first. buildPrBody throws if any of the five required sections is empty,
    // so rule 4 is enforced before a branch or commit is ever created. Fail closed, no state.
    const title = buildPrTitle(input.finding)
    const body = buildPrBody({
      finding: input.finding,
      expectedEffect: input.expectedEffect,
      rollback: input.rollback,
    })

    if (input.files.length === 0) {
      throw new Error('Refusing to open a pull request with no file changes.')
    }

    // One PR per thing. A retried fix job, or a second click, must not open a duplicate. Keyed
    // on dedupeKey when the branch is deliberately unique per attempt, else on the finding id.
    const existing = await api.findOpenPullRequestByHeadPrefix(
      branchPrefixFor(input.dedupeKey ?? input.finding.id),
    )
    if (existing) return existing

    const base = input.baseBranch ?? (await api.getDefaultBranch())
    const branch = branchNameFor(input.finding)

    // The interface already makes writing to the base branch impossible. This guard closes the
    // one way a caller could still collapse the distinction: passing a base equal to our head.
    if (branch === base) {
      throw new Error(
        `Refusing to open a pull request whose head branch (${branch}) is the base branch.`,
      )
    }

    const baseSha = await api.getBranchHeadSha(base)
    await api.createBranch(branch, baseSha)

    for (const file of input.files) {
      // An update needs the current blob sha; a create must omit it. Read on the fix branch,
      // which was just cut from base, so the sha is whatever base had.
      const current = await api.getFile(file.path, branch)
      await api.putFile({
        branch,
        path: file.path,
        content: file.content,
        message: `${input.finding.ruleId}: ${input.finding.title}`,
        sha: current?.sha,
      })
    }

    const pr = await api.createPullRequest({ head: branch, base, title, body })
    return { url: pr.url, number: pr.number, branch }
  }
}
