import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { createGitHubApp } from '../src/github/client.js'
import type { DeploymentEvidence } from '../src/vercel-deployment.js'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('octokit', () => ({
  App: class {
    async getInstallationOctokit() {
      return { request }
    }
  },
}))
const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey
const merge = 'a'.repeat(40)
const current = 'b'.repeat(40)
beforeEach(() => {
  request.mockReset()
})

async function check(evidence: DeploymentEvidence, relation = 'ahead') {
  request.mockImplementation(async (route: string) => {
    if (route.endsWith('/pulls/{pull_number}'))
      return {
        data: { merged_at: '2026-10-04', merge_commit_sha: merge, base: { repo: { id: 7 } } },
      }
    if (route.endsWith('/compare/{basehead}')) return { data: { status: relation } }
    if (route.endsWith('/deployments')) return { data: [] }
    throw new Error('Unexpected request')
  })
  const api = await createGitHubApp({
    appId: '1',
    privateKey,
    deploymentLookup: async () => evidence,
  }).apiFor({ repo: { owner: 'owner', name: 'repo' }, installationId: 1 })
  return api.isPullRequestDeployed!(26, 'https://site.example')
}

it('accepts an exact merge or its confirmed descendant', async () => {
  expect(await check({ status: 'confirmed', sha: merge })).toBe(true)
  expect(await check({ status: 'confirmed', sha: current })).toBe(true)
})
it.each(['behind', 'diverged'])(
  'rejects a current %s deployment without falling back to history',
  async (relation) => {
    expect(await check({ status: 'confirmed', sha: current }, relation)).toBe(false)
    expect(request.mock.calls.some(([route]) => String(route).endsWith('/deployments'))).toBe(false)
  },
)
it('does not bypass missing hosting proof with historical GitHub deployment evidence', async () => {
  expect(await check({ status: 'unconfirmed' })).toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})
it('retains GitHub deployment checks for sites absent from the configured hosting account', async () => {
  expect(await check({ status: 'not-found' })).toBe(false)
  expect(request.mock.calls.some(([route]) => String(route).endsWith('/deployments'))).toBe(true)
})
