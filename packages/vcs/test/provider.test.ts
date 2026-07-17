import { describe, expect, it } from 'vitest'
import { branchNameFor } from '../src/branch.js'
import { GitHubProvider, type GitHubApi } from '../src/github/provider.js'
import type { FixPullRequest, RepoContext, RepoFile } from '../src/provider.js'
import { makeFinding } from './fixtures.js'

/**
 * A fake GitHub with no network. It records every call, so a test can assert not only what the
 * provider produced but what it refused to do: there is no way to write to the base branch,
 * and the tests prove the provider never tries.
 */
class FakeGitHubApi implements GitHubApi {
  defaultBranch = 'main'
  existingPr: { url: string; number: number; branch: string } | null = null
  filesByPath = new Map<string, RepoFile>()

  calls: string[] = []
  createdBranch?: { branch: string; fromSha: string }
  puts: Array<{ branch: string; path: string; content: string; sha?: string }> = []
  prInput?: { head: string; base: string; title: string; body: string }

  async getDefaultBranch() {
    this.calls.push('getDefaultBranch')
    return this.defaultBranch
  }
  async getBranchHeadSha(branch: string) {
    this.calls.push(`getBranchHeadSha:${branch}`)
    return 'base-sha'
  }
  async getFile(path: string, ref: string): Promise<RepoFile | null> {
    this.calls.push(`getFile:${ref}:${path}`)
    return this.filesByPath.get(path) ?? null
  }
  async createBranch(branch: string, fromSha: string) {
    this.calls.push(`createBranch:${branch}`)
    this.createdBranch = { branch, fromSha }
  }
  async putFile(input: { branch: string; path: string; content: string; sha?: string }) {
    this.calls.push(`putFile:${input.branch}:${input.path}`)
    this.puts.push(input)
  }
  async createPullRequest(input: { head: string; base: string; title: string; body: string }) {
    this.calls.push('createPullRequest')
    this.prInput = input
    return { url: 'https://github.com/o/r/pull/7', number: 7 }
  }
  async findOpenPullRequestByHeadPrefix(prefix: string) {
    this.calls.push(`find:${prefix}`)
    return this.existingPr
  }
}

const ctx: RepoContext = { repo: { owner: 'o', name: 'r' }, installationId: 1 }

function providerWith(api: FakeGitHubApi) {
  return new GitHubProvider(() => api)
}

const fix: FixPullRequest = {
  finding: makeFinding(),
  files: [{ path: 'app/layout.tsx', content: '<link rel="canonical" href="..."/>' }],
  expectedEffect: 'Ranking signals stop being split across duplicate URLs.',
  rollback: 'Revert the merge commit.',
}

const expectedBranch = branchNameFor(fix.finding)

describe('GitHubProvider.openPullRequest', () => {
  it('cuts a seo-agent branch off the base and opens a PR against the base', async () => {
    const api = new FakeGitHubApi()
    const pr = await providerWith(api).openPullRequest(ctx, fix)

    expect(api.createdBranch?.branch).toBe(expectedBranch)
    expect(expectedBranch).toMatch(/^seo-agent\//)
    expect(api.createdBranch?.fromSha).toBe('base-sha')
    expect(api.prInput?.base).toBe('main')
    expect(api.prInput?.head).toBe(api.createdBranch?.branch)
    expect(pr).toEqual({ url: 'https://github.com/o/r/pull/7', number: 7, branch: api.createdBranch?.branch })
  })

  it('never writes to the base branch', async () => {
    const api = new FakeGitHubApi()
    await providerWith(api).openPullRequest(ctx, fix)

    // Every write went to the fix branch, and the fix branch is not the base branch.
    expect(api.createdBranch?.branch).not.toBe('main')
    for (const put of api.puts) {
      expect(put.branch).toBe(api.createdBranch?.branch)
      expect(put.branch).not.toBe('main')
    }
  })

  it('passes the existing blob sha when updating a file that is already there', async () => {
    const api = new FakeGitHubApi()
    api.filesByPath.set('app/layout.tsx', { content: 'old', sha: 'blob-sha' })
    await providerWith(api).openPullRequest(ctx, fix)

    expect(api.puts[0]?.sha).toBe('blob-sha')
  })

  it('is idempotent: returns the existing PR and creates nothing when one is already open', async () => {
    const api = new FakeGitHubApi()
    api.existingPr = { url: 'https://github.com/o/r/pull/3', number: 3, branch: 'seo-agent/TECH-006-abc123-old' }
    const pr = await providerWith(api).openPullRequest(ctx, fix)

    expect(pr.number).toBe(3)
    expect(api.createdBranch).toBeUndefined()
    expect(api.calls).not.toContain('createPullRequest')
  })

  it('refuses (rule 4) and creates nothing when the finding has no falsification', async () => {
    const api = new FakeGitHubApi()
    const finding = makeFinding({ falsification: '  ' })
    await expect(providerWith(api).openPullRequest(ctx, { ...fix, finding })).rejects.toThrow()

    expect(api.createdBranch).toBeUndefined()
    expect(api.calls).not.toContain('createPullRequest')
  })

  it('refuses when the base branch equals the computed head branch', async () => {
    const api = new FakeGitHubApi()
    await expect(
      providerWith(api).openPullRequest(ctx, { ...fix, baseBranch: expectedBranch }),
    ).rejects.toThrow(/base branch/)
    expect(api.createdBranch).toBeUndefined()
  })

  it('refuses a PR with no file changes', async () => {
    const api = new FakeGitHubApi()
    await expect(providerWith(api).openPullRequest(ctx, { ...fix, files: [] })).rejects.toThrow()
    expect(api.createdBranch).toBeUndefined()
  })
})

describe('GitHubProvider.getFile', () => {
  it('reads from the default branch when no ref is given', async () => {
    const api = new FakeGitHubApi()
    api.filesByPath.set('robots.txt', { content: 'User-agent: *', sha: 's' })
    const file = await providerWith(api).getFile(ctx, 'robots.txt')

    expect(file?.content).toBe('User-agent: *')
    expect(api.calls).toContain('getFile:main:robots.txt')
  })
})
