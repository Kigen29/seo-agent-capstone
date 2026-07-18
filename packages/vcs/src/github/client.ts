import { App } from 'octokit'
import type { RepoContext, RepoFile } from '../provider.js'
import type { GitHubApi, GitHubApiFactory } from './provider.js'

/**
 * The one file in the package that imports the GitHub SDK.
 *
 * Everything else in `@seo/vcs` talks to the `GitHubApi` interface, so this adapter is the
 * only place Octokit's shape leaks in, and swapping the SDK, or adding GitLab, means writing a
 * sibling of this file and nothing more. It mirrors the ADR-0005 rule that only one file may
 * import an LLM vendor SDK.
 */

export interface GitHubAppConfig {
  appId: string
  privateKey: string
}

/**
 * Read the App credentials from the environment. The private key is often stored with literal
 * "\n" rather than real newlines (env vars and secret stores mangle multiline values), so both
 * forms are accepted and normalised to a real PEM.
 */
export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
  // Not GITHUB_*: that prefix is reserved for GitHub Actions secrets, which refuses to store a
  // name beginning with it. The same names have to work in Actions (the worker) and in Render
  // (the API), so GH_APP_* is used in both places.
  const appId = env.GH_APP_ID
  const privateKey = env.GH_APP_PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error(
      'GH_APP_ID and GH_APP_PRIVATE_KEY must be set to open pull requests. They are the GitHub ' +
        'App credentials from ADR-0002, and they live in the secret stores, never in the repo.',
    )
  }

  return { appId, privateKey: privateKey.replace(/\\n/g, '\n') }
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined
}

/** A repository an installation can reach, resolved from the installation itself. */
export interface InstalledRepo {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
}

/**
 * The App, wired once. `apiFor` is the per-repo provider factory; `listInstallationRepositories`
 * answers the one installation-scoped question the provider interface does not cover: which
 * repos did the client actually grant, so the connect callback can resolve the repo behind an
 * installation id.
 */
export interface GitHubApp {
  apiFor: GitHubApiFactory
  listInstallationRepositories(installationId: number): Promise<InstalledRepo[]>
}

/**
 * Build the App. One App instance signs the JWTs; installation Octokit clients are cached per
 * installation so we do not mint a token on every call. The App library refreshes an
 * installation token before it expires, so the cache is safe to hold.
 */
export function createGitHubApp(config: GitHubAppConfig): GitHubApp {
  const app = new App({ appId: config.appId, privateKey: config.privateKey })
  const clients = new Map<number, Awaited<ReturnType<typeof app.getInstallationOctokit>>>()

  async function octokitFor(installationId: number) {
    const cached = clients.get(installationId)
    if (cached) return cached
    const client = await app.getInstallationOctokit(installationId)
    clients.set(installationId, client)
    return client
  }

  const apiFor: GitHubApiFactory = (ctx: RepoContext): GitHubApi => {
    const { owner, name: repo } = ctx.repo

    // Calls go through octokit.request(route, params), which lives on the base Octokit that
    // App hands back and is typed from the route string. That avoids depending on the .rest
    // plugin surface, whose types are not exposed on an installation client.
    return {
      async getDefaultBranch() {
        const octokit = await octokitFor(ctx.installationId)
        const { data } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo })
        return data.default_branch
      },

      async getBranchHeadSha(branch) {
        const octokit = await octokitFor(ctx.installationId)
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
          owner,
          repo,
          ref: `heads/${branch}`,
        })
        return data.object.sha
      },

      async getFile(path, ref): Promise<RepoFile | null> {
        const octokit = await octokitFor(ctx.installationId)
        try {
          const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path,
            ref,
          })
          // A directory comes back as an array; only a file carries content to read.
          if (Array.isArray(data) || data.type !== 'file') return null
          return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha }
        } catch (error) {
          if (statusOf(error) === 404) return null
          throw error
        }
      },

      async createBranch(branch, fromSha) {
        const octokit = await octokitFor(ctx.installationId)
        try {
          await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha: fromSha,
          })
        } catch (error) {
          // 422 means the ref already exists, which happens when a fix job is retried. Reuse it.
          if (statusOf(error) === 422) return
          throw error
        }
      },

      async putFile(input) {
        const octokit = await octokitFor(ctx.installationId)
        await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
          owner,
          repo,
          path: input.path,
          message: input.message,
          content: Buffer.from(input.content, 'utf8').toString('base64'),
          branch: input.branch,
          sha: input.sha,
        })
      },

      async createPullRequest(input) {
        const octokit = await octokitFor(ctx.installationId)
        const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          head: input.head,
          base: input.base,
          title: input.title,
          body: input.body,
        })
        return { url: data.html_url, number: data.number }
      },

      async findOpenPullRequestByHeadPrefix(prefix) {
        const octokit = await octokitFor(ctx.installationId)
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          state: 'open',
          per_page: 100,
        })
        const match = data.find((pr) => pr.head.ref.startsWith(prefix))
        return match ? { url: match.html_url, number: match.number, branch: match.head.ref } : null
      },
    }
  }

  async function listInstallationRepositories(installationId: number): Promise<InstalledRepo[]> {
    const octokit = await octokitFor(installationId)
    const { data } = await octokit.request('GET /installation/repositories', { per_page: 100 })
    return data.repositories.map((r) => ({
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
    }))
  }

  return { apiFor, listInstallationRepositories }
}

/** Back-compat: just the provider factory, for a caller that does not need installation listing. */
export function createGitHubApiFactory(config: GitHubAppConfig): GitHubApiFactory {
  return createGitHubApp(config).apiFor
}
