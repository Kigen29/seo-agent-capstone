import { expect, it, vi } from 'vitest'
import { confirmsDeployment } from '../src/github/deployment.js'

const deployment = (id: number, sha: string) => ({
  id,
  sha,
  production_environment: true,
  created_at: `2026-10-0${id}T00:00:00Z`,
})
const success = async () => ({ state: 'success', environment_url: 'https://example.com/' })

it('accepts the exact merge and a later deployment containing it', async () => {
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [deployment(1, 'fix')],
      success,
      vi.fn(),
    ),
  ).toBe(true)
  const compare = vi.fn(async () => 'ahead')
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [deployment(2, 'later')],
      success,
      compare,
    ),
  ).toBe(true)
  expect(compare).toHaveBeenCalledWith('fix', 'later')
})
it.each(['behind', 'diverged'])(
  'does not verify an older success after a %s deployment',
  async (relation) => {
    expect(
      await confirmsDeployment(
        'fix',
        'https://example.com',
        [deployment(1, 'fix'), deployment(2, 'rollback')],
        success,
        async () => relation,
      ),
    ).toBe(false)
  },
)
it('fails closed on an unreadable comparison rather than using an old deployment', async () => {
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [deployment(1, 'fix'), deployment(2, 'unknown')],
      success,
      async () => {
        throw new Error('permission denied')
      },
    ),
  ).toBe(false)
})
it('requires successful production evidence for the exact origin', async () => {
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [{ ...deployment(1, 'fix'), production_environment: false }],
      success,
      vi.fn(),
    ),
  ).toBe(false)
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [deployment(1, 'fix')],
      async () => ({ state: 'success', environment_url: 'https://preview.example.com' }),
      vi.fn(),
    ),
  ).toBe(false)
  expect(
    await confirmsDeployment(
      'fix',
      'https://example.com',
      [deployment(1, 'fix')],
      async () => ({ state: 'pending', environment_url: 'https://example.com' }),
      vi.fn(),
    ),
  ).toBe(false)
})
