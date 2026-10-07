export type {
  FileChange,
  FixPullRequest,
  PullRequest,
  RepoContext,
  RepoFile,
  RepoRef,
  RepoTreeEntry,
  VersionControlProvider,
} from './provider.js'

export { BRANCH_NAMESPACE, slugify, branchPrefixFor, branchNameFor } from './branch.js'

export { buildPrTitle, buildPrBody, IncompletePullRequestError } from './pr-body.js'
export type { PullRequestContent } from './pr-body.js'

export { GitHubProvider } from './github/provider.js'
export type { GitHubApi, GitHubApiFactory } from './github/provider.js'

export { createGitHubApp, createGitHubApiFactory, githubAppConfigFromEnv } from './github/client.js'
export type { GitHubApp, GitHubAppConfig, InstalledRepo } from './github/client.js'

export { verifyWebhookSignature, SIGNATURE_HEADER } from './github/webhook.js'
export { createVercelDeploymentLookup } from './vercel-deployment.js'
export { exchangeVercelCode, findVercelProjects, vercelConsentUrl } from './vercel-connect.js'
export type { VercelGrant, VercelIntegration, VercelProject } from './vercel-connect.js'
export type { DeploymentLookup, DeploymentEvidence } from './vercel-deployment.js'
