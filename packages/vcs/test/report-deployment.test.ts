import { expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportDeployment } from '../src/report-deployment.js'
import { confirmsDeployment } from '../src/github/deployment.js'

const sha = 'a'.repeat(40)
const env = {
  GH_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'owner/site',
  DEPLOYED_SHA: sha,
  DEPLOYMENT_PHASE: 'start',
  SITE_ORIGIN: 'https://example.com',
}
const deployment = {
  id: 12,
  sha,
  production_environment: true,
  payload: { rankwright: 1, origin: env.SITE_ORIGIN },
}

it('runs directly on Node without build dependencies and reports configuration errors safely', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../src/report-deployment.ts', import.meta.url))],
    {
      env: { ...process.env, GH_TOKEN: '' },
      encoding: 'utf8',
      timeout: 15000,
    },
  )
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Deployment reporting failed.')
  expect(result.stderr).not.toContain('ERR_')
})
function responses(...bodies: unknown[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(bodies.shift()))
}

it('starts an exact production report without auto-merging or bypassing commit checks', async () => {
  const fetch = responses(deployment, {})
  expect(await reportDeployment(env, fetch)).toBe(12)
  const [url, request] = fetch.mock.calls[0]!
  expect(url).toBe('https://api.github.com/repos/owner/site/deployments')
  const body = JSON.parse(request!.body as string)
  expect(body).toMatchObject({
    ref: sha,
    auto_merge: false,
    production_environment: true,
    payload: { origin: env.SITE_ORIGIN },
  })
  expect(body).not.toHaveProperty('required_contexts')
  expect(request!.redirect).toBe('error')
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toMatchObject({
    state: 'in_progress',
    environment_url: env.SITE_ORIGIN,
  })
})

it.each(['success', 'failure'])('completes a matching in-progress report as %s', async (phase) => {
  const fetch = responses(
    deployment,
    [{ state: 'in_progress', environment_url: env.SITE_ORIGIN }],
    {},
  )
  await reportDeployment({ ...env, DEPLOYMENT_PHASE: phase, DEPLOYMENT_ID: '12' }, fetch)
  expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toMatchObject({
    state: phase,
    auto_inactive: false,
  })
})

it.each([
  { sha: 'b'.repeat(40) },
  { production_environment: false },
  { payload: { rankwright: 1, origin: 'https://other.example' } },
  { payload: {} },
])('rejects completion of a mismatched deployment: %j', async (change) => {
  const fetch = responses({ ...deployment, ...change })
  await expect(
    reportDeployment({ ...env, DEPLOYMENT_PHASE: 'success', DEPLOYMENT_ID: '12' }, fetch),
  ).rejects.toThrow('does not match')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['success', 'failure', 'inactive'])('cannot replay a terminal %s report', async (state) => {
  const fetch = responses(deployment, [{ state, environment_url: env.SITE_ORIGIN }])
  await expect(
    reportDeployment({ ...env, DEPLOYMENT_PHASE: 'success', DEPLOYMENT_ID: '12' }, fetch),
  ).rejects.toThrow('in-progress')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([
  { DEPLOYED_SHA: 'main' },
  { SITE_ORIGIN: 'http://example.com' },
  { SITE_ORIGIN: 'https://user:password@example.com' },
  { SITE_ORIGIN: 'https://example.com/path' },
  { SITE_ORIGIN: 'https://example.com/?secret=value' },
  { GITHUB_REPOSITORY: '../site' },
  { DEPLOYMENT_PHASE: 'success', DEPLOYMENT_ID: '12/../../other' },
])('rejects invalid input before network access: %j', async (change) => {
  const fetch = responses()
  await expect(reportDeployment({ ...env, ...change }, fetch)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('does not expose provider error bodies', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response('sensitive provider body', { status: 403 }),
  )
  await expect(reportDeployment(env, fetch)).rejects.toThrow(
    'GitHub deployment request failed (403)',
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('feeds the host-independent verifier and blocks a subsequent incomplete rollback', async () => {
  const records: {
    id: number
    sha: string
    created_at: string
    production_environment: boolean
  }[] = []
  const statuses = new Map<number, { state: string; environment_url: string }>()
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    if (path.endsWith('/deployments')) {
      const record = {
        ...deployment,
        id: records.length + 1,
        sha: body.ref,
        created_at: new Date(records.length * 1000).toISOString(),
      }
      records.push(record)
      return Response.json(record)
    }
    const id = Number(path.split('/deployments/')[1]!.split('/')[0])
    if (path.endsWith('/statuses')) {
      if (body) {
        statuses.set(id, body)
        return Response.json(body)
      }
      return Response.json([statuses.get(id)])
    }
    return Response.json(records.find((record) => record.id === id))
  })
  const confirmed = () =>
    confirmsDeployment(
      sha,
      env.SITE_ORIGIN,
      records,
      async (id) => statuses.get(id),
      async () => 'behind',
    )
  const id = await reportDeployment(env, request)
  expect(await confirmed()).toBe(false)
  await reportDeployment(
    { ...env, DEPLOYMENT_PHASE: 'success', DEPLOYMENT_ID: String(id) },
    request,
  )
  expect(await confirmed()).toBe(true)
  await reportDeployment({ ...env, DEPLOYED_SHA: 'b'.repeat(40) }, request)
  expect(await confirmed()).toBe(false)
})
