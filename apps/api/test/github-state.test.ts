import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

// A known key, so signing and verifying agree here and in CI, which has no .env. Set before the
// module under test reads it.
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const { signInstallState, verifyInstallState } = await import('../src/github-state.js')

const STATE = { tenantId: 'tenant-1', siteId: 'site-1' }

describe('the GitHub install state', () => {
  it('round-trips the tenant and site it was minted for', () => {
    const verified = verifyInstallState(signInstallState(STATE))
    expect(verified).toEqual(STATE)
  })

  it('rejects a tampered payload', () => {
    const state = signInstallState(STATE)
    const [payload, sig] = state.split('.')
    // Flip a character in the payload; the signature no longer matches it.
    const tampered = `${payload!.slice(0, -1)}${payload!.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`
    expect(verifyInstallState(tampered)).toBeUndefined()
  })

  it('rejects a forged signature', () => {
    const [payload] = signInstallState(STATE).split('.')
    expect(verifyInstallState(`${payload}.deadbeef`)).toBeUndefined()
  })

  it('rejects a stale state', () => {
    const state = signInstallState(STATE, Date.now() - 20 * 60 * 1000)
    expect(verifyInstallState(state)).toBeUndefined()
  })

  it('rejects a state minted in the future', () => {
    const state = signInstallState(STATE, Date.now() + 5 * 60 * 1000)
    expect(verifyInstallState(state)).toBeUndefined()
  })

  it('rejects a malformed state', () => {
    expect(verifyInstallState('')).toBeUndefined()
    expect(verifyInstallState('nodot')).toBeUndefined()
  })
})
