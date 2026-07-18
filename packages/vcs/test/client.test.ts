import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createGitHubApp, githubAppConfigFromEnv } from '../src/github/client.js'

/** Generate an RSA private key in the requested PEM format. */
function keyPem(type: 'pkcs1' | 'pkcs8'): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type, format: 'pem' },
  }).privateKey as string
}

describe('createGitHubApp private key handling', () => {
  it("accepts a PKCS#1 key, which is the format GitHub's download gives you", () => {
    // This is the exact case that failed in production: octokit's signer needs PKCS#8, and a
    // raw GitHub key ("BEGIN RSA PRIVATE KEY") is PKCS#1. It must be normalised, not rejected.
    expect(() => createGitHubApp({ appId: '1', privateKey: keyPem('pkcs1') })).not.toThrow()
  })

  it('accepts a PKCS#8 key', () => {
    expect(() => createGitHubApp({ appId: '1', privateKey: keyPem('pkcs8') })).not.toThrow()
  })

  it('rejects a malformed key with a message that names the fix', () => {
    expect(() => createGitHubApp({ appId: '1', privateKey: 'not a key' })).toThrow(
      /GH_APP_PRIVATE_KEY/,
    )
  })
})

describe('githubAppConfigFromEnv', () => {
  const env = (privateKey: string): NodeJS.ProcessEnv =>
    ({ GH_APP_ID: '1', GH_APP_PRIVATE_KEY: privateKey }) as NodeJS.ProcessEnv

  it('accepts a raw PEM and yields a usable key', () => {
    const cfg = githubAppConfigFromEnv(env(keyPem('pkcs1')))
    expect(cfg.privateKey).toContain('BEGIN')
    expect(() => createGitHubApp(cfg)).not.toThrow()
  })

  it('accepts a base64-encoded PEM, the form that survives a hosted env field', () => {
    const base64 = Buffer.from(keyPem('pkcs8')).toString('base64')
    const cfg = githubAppConfigFromEnv(env(base64))
    expect(cfg.privateKey).toContain('BEGIN')
    expect(() => createGitHubApp(cfg)).not.toThrow()
  })

  it('throws when the credentials are missing', () => {
    expect(() => githubAppConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/GH_APP_ID/)
  })
})
