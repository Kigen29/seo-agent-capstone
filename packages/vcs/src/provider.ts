import type { Finding } from '@seo/core'

/**
 * The version-control seam. Everything the fixer does to a client's repository goes through
 * this interface, and never through a raw GitHub call, so a second provider (GitLab, Bitbucket)
 * is a new file rather than a rewrite. See ADR-0002.
 *
 * The interface is deliberately small, and deliberately missing one thing: there is no method
 * that writes to a branch the caller names freely, and no method that pushes a commit anywhere
 * except a fresh `seo-agent/*` branch behind a pull request. CLAUDE.md rule 2 ("never push to
 * main, ever") is therefore not a convention a fixer has to remember. It is a shape the code
 * cannot express. You cannot call a method that does not exist.
 */

/** A repository, addressed the way GitHub addresses one. */
export interface RepoRef {
  owner: string
  name: string
}

/**
 * Everything a provider needs to act on one repo on behalf of one tenant.
 *
 * `installationId` is the GitHub App installation the client created when they added the App
 * to this repo. It is what an installation access token is minted from, and it is per repo,
 * so a leaked context can touch exactly one repository and nothing else.
 */
export interface RepoContext {
  repo: RepoRef
  installationId: number
}

/** A file to write in the fix branch. `content` is the whole new file, not a patch. */
export interface FileChange {
  path: string
  content: string
}

/** A file read back from the repo, with the blob sha an update needs. */
export interface RepoFile {
  content: string
  sha: string
}

/**
 * A request to open a pull request that fixes one finding.
 *
 * `expectedEffect` and `rollback` are separate required fields, not optional prose, because
 * CLAUDE.md rule 4 requires every PR body to carry them and the body builder refuses to
 * render without them. The finding already carries its own evidence and falsification, so the
 * five required sections are complete the moment this object is.
 */
export interface FixPullRequest {
  finding: Finding
  files: FileChange[]
  /** What we expect to change if this works, in plain language. */
  expectedEffect: string
  /** How a human undoes this if it goes wrong. */
  rollback: string
  /** The branch to open against. Defaults to the repository's default branch. */
  baseBranch?: string
}

/** A pull request the agent opened. */
export interface PullRequest {
  url: string
  number: number
  /** The `seo-agent/*` branch it was opened from. */
  branch: string
}

export interface VersionControlProvider {
  /** Read a file at a ref (the default branch when omitted). Null when the file is absent. */
  getFile(ctx: RepoContext, path: string, ref?: string): Promise<RepoFile | null>

  /**
   * Open a pull request that fixes a finding. Creates the `seo-agent/*` branch, writes the
   * files onto it, and opens the PR against the base branch. It never writes to the base
   * branch itself. Idempotent per finding: if a PR is already open for this finding, it is
   * returned rather than a second one being created.
   */
  openPullRequest(ctx: RepoContext, input: FixPullRequest): Promise<PullRequest>

  /** The pull request already open for this finding, matched by branch, or null. */
  findOpenPullRequest(ctx: RepoContext, findingId: string): Promise<PullRequest | null>
}
