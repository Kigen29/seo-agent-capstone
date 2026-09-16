import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGitHubIdentity } from '../src/identity/github.js'
import { createGoogleIdentity } from '../src/identity/google.js'
import {
  newNonce,
  readCookie,
  safeNext,
  signSigninState,
  verifySigninState,
} from '../src/identity/state.js'

beforeAll(() => {
  // The state HMAC borrows this key, like the Search Console state does. Set before anything signs.
  process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
})

/** A fetch that answers from a script keyed on URL, and records what it was asked. */
function fakeFetch(routes: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: { url: string; init?: RequestInit }[] = []

  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, ...(init ? { init } : {}) })

    /*
      Longest match wins, and that is not a detail.

      `https://api.github.com/user` is a prefix of `.../user/emails`, so a first-match lookup
      answers the emails request with the user object. Three tests here passed against that fake
      while asserting nothing real, which is the failure mode a test is least likely to notice.
    */
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => url.startsWith(candidate))
    if (!key) throw new Error(`unexpected fetch: ${url}`)

    return {
      ok: (status[key] ?? 200) < 400,
      status: status[key] ?? 200,
      json: async () => routes[key],
      text: async () => JSON.stringify(routes[key]),
    } as Response
  }) as typeof globalThis.fetch

  return { impl, calls }
}

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.example.com/auth/signin/callback',
}

/** A Google id_token is three dot-separated segments; only the middle one is ever read. */
const idToken = (claims: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`

describe('the sign-in state', () => {
  it('round-trips the provider, the nonce and the next path', () => {
    const state = signSigninState({ provider: 'github', nonce: 'abc', next: '/findings' })
    expect(verifySigninState(state)).toEqual({
      provider: 'github',
      nonce: 'abc',
      next: '/findings',
    })
  })

  it('refuses a tampered payload', () => {
    /*
      The attack this stops is swapping the provider after the fact: presenting a state minted
      for one provider so the code is redeemed against another. The provider is read from inside
      the signature for exactly that reason.
    */
    const state = signSigninState({ provider: 'github', nonce: 'abc' })
    const [payload, sig] = state.split('.')
    const forged = Buffer.from(
      JSON.stringify({ provider: 'google', nonce: 'abc', iat: Date.now() }),
    )

    expect(verifySigninState(`${forged.toString('base64url')}.${sig}`)).toBeUndefined()
    expect(payload).toBeDefined()
  })

  it('refuses a state that is stale, and one minted in the future', () => {
    const old = signSigninState({ provider: 'github', nonce: 'abc' }, Date.now() - 11 * 60 * 1000)
    expect(verifySigninState(old)).toBeUndefined()

    // A clock far ahead of ours is either a broken client or somebody extending the window.
    const ahead = signSigninState({ provider: 'github', nonce: 'abc' }, Date.now() + 5 * 60 * 1000)
    expect(verifySigninState(ahead)).toBeUndefined()
  })

  it('refuses anything that is not two signed parts', () => {
    expect(verifySigninState('')).toBeUndefined()
    expect(verifySigninState('nodot')).toBeUndefined()
  })

  it('mints a nonce that is not guessable, and not the same twice', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()))
    expect(nonces.size).toBe(50)
    expect(newNonce().length).toBeGreaterThanOrEqual(30)
  })
})

describe('safeNext', () => {
  it('allows an ordinary path', () => {
    expect(safeNext('/findings?severity=high')).toBe('/findings?severity=high')
  })

  it('refuses a protocol-relative URL, which a browser resolves to another origin', () => {
    // The whole open-redirect class. `//evil.example` starts with a slash and is not a path.
    expect(safeNext('//evil.example/steal')).toBeUndefined()
  })

  it('refuses an absolute URL and an empty value', () => {
    expect(safeNext('https://evil.example')).toBeUndefined()
    expect(safeNext(undefined)).toBeUndefined()
  })
})

describe('readCookie', () => {
  it('finds one cookie among several, and ignores a prefix match', () => {
    const header = 'other=1; seo_signin_nonce=wanted; seo_signin_nonce_extra=no'
    expect(readCookie(header, 'seo_signin_nonce')).toBe('wanted')
  })

  it('returns undefined for a missing header or a missing name', () => {
    expect(readCookie(undefined, 'seo_signin_nonce')).toBeUndefined()
    expect(readCookie('a=1', 'seo_signin_nonce')).toBeUndefined()
  })
})

describe('the GitHub identity provider', () => {
  it('sends the browser to GitHub with the state, and asks for no scope', () => {
    const url = createGitHubIdentity(config).authUrl('signed-state')

    expect(url).toContain('https://github.com/login/oauth/authorize')
    expect(url).toContain('state=signed-state')
    // GitHub Apps ignore `scope`; what the token may do is set on the App. Asking would mislead.
    expect(url).not.toContain('scope=')
  })

  it('identifies an account by its numeric id, never by its login or email', () => {
    const { impl } = fakeFetch({
      'https://github.com/login/oauth/access_token': { access_token: 'gho_x' },
      'https://api.github.com/user': {
        id: 4242,
        login: 'kigen',
        name: 'Kigen',
        email: 'k@example.com',
        avatar_url: 'https://avatars.example/k.png',
      },
    })

    return expect(
      createGitHubIdentity({ ...config, fetch: impl }).identify('code'),
    ).resolves.toEqual({
      provider: 'github',
      accountId: '4242',
      name: 'Kigen',
      avatarUrl: 'https://avatars.example/k.png',
      email: 'k@example.com',
    })
  })

  it('falls back to the login when the account has no display name', async () => {
    const { impl } = fakeFetch({
      'https://github.com/login/oauth/access_token': { access_token: 'gho_x' },
      'https://api.github.com/user': {
        id: 1,
        login: 'kigen',
        name: null,
        email: null,
        avatar_url: null,
      },
      'https://api.github.com/user/emails': [],
    })

    const identity = await createGitHubIdentity({ ...config, fetch: impl }).identify('code')
    expect(identity.name).toBe('kigen')
  })

  it('signs in fine when GitHub will not give up an email', async () => {
    /*
      A private email is the default for a lot of accounts, and /user/emails needs an account
      permission the App may not have been granted. Neither is worth blocking a sign-in over: the
      account id is the identifier and the email is only ever displayed.
    */
    const { impl } = fakeFetch(
      {
        'https://github.com/login/oauth/access_token': { access_token: 'gho_x' },
        'https://api.github.com/user': {
          id: 7,
          login: 'ghost',
          name: null,
          email: null,
          avatar_url: null,
        },
        'https://api.github.com/user/emails': { message: 'Not Found' },
      },
      { 'https://api.github.com/user/emails': 404 },
    )

    const identity = await createGitHubIdentity({ ...config, fetch: impl }).identify('code')
    expect(identity.accountId).toBe('7')
    expect(identity.email).toBeUndefined()
  })

  it('takes the primary verified email, and never an unverified one', async () => {
    const { impl } = fakeFetch({
      'https://github.com/login/oauth/access_token': { access_token: 'gho_x' },
      'https://api.github.com/user': {
        id: 8,
        login: 'k',
        name: null,
        email: null,
        avatar_url: null,
      },
      'https://api.github.com/user/emails': [
        { email: 'unverified@example.com', primary: true, verified: false },
        { email: 'verified@example.com', primary: false, verified: true },
      ],
    })

    const identity = await createGitHubIdentity({ ...config, fetch: impl }).identify('code')
    // An unverified address proves nothing about who controls it, primary or not.
    expect(identity.email).toBe('verified@example.com')
  })

  it('throws on the 200-with-an-error GitHub answers a bad code with', async () => {
    // Checking response.ok alone sails past this and fails later with an unrelated 401 from /user.
    const { impl } = fakeFetch({
      'https://github.com/login/oauth/access_token': { error: 'bad_verification_code' },
    })

    await expect(
      createGitHubIdentity({ ...config, fetch: impl }).identify('stale'),
    ).rejects.toThrow(/bad_verification_code/)
  })
})

describe('the Google identity provider', () => {
  it('asks only for identity scopes, and not for offline access', () => {
    const url = createGoogleIdentity(config).authUrl('signed-state')

    expect(url).toContain('scope=openid+email+profile')
    /*
      The Search Console flow must send these to get a refresh token, and signing in must not.
      Reusing that flow would mean re-consenting to Search Console access just to log in, which
      is both annoying and untrue about what the button does.
    */
    expect(url).not.toContain('access_type=offline')
    expect(url).not.toContain('prompt=consent')
  })

  it('identifies an account by the id_token subject', () => {
    const { impl } = fakeFetch({
      'https://oauth2.googleapis.com/token': {
        id_token: idToken({
          sub: '110000000',
          email: 'k@example.com',
          email_verified: true,
          name: 'Kigen',
          picture: 'https://lh3.example/k.png',
        }),
      },
    })

    return expect(
      createGoogleIdentity({ ...config, fetch: impl }).identify('code'),
    ).resolves.toEqual({
      provider: 'google',
      accountId: '110000000',
      email: 'k@example.com',
      name: 'Kigen',
      avatarUrl: 'https://lh3.example/k.png',
    })
  })

  it('drops an unverified email rather than showing it as proven', async () => {
    const { impl } = fakeFetch({
      'https://oauth2.googleapis.com/token': {
        id_token: idToken({ sub: '1', email: 'unproven@example.com', email_verified: false }),
      },
    })

    const identity = await createGoogleIdentity({ ...config, fetch: impl }).identify('code')
    expect(identity.accountId).toBe('1')
    expect(identity.email).toBeUndefined()
  })

  it('refuses a token response with no id_token, and one with no subject', async () => {
    const missing = fakeFetch({ 'https://oauth2.googleapis.com/token': { access_token: 'x' } })
    await expect(
      createGoogleIdentity({ ...config, fetch: missing.impl }).identify('code'),
    ).rejects.toThrow(/no id_token/)

    const subjectless = fakeFetch({
      'https://oauth2.googleapis.com/token': { id_token: idToken({ email: 'k@example.com' }) },
    })
    await expect(
      createGoogleIdentity({ ...config, fetch: subjectless.impl }).identify('code'),
    ).rejects.toThrow(/subject/)
  })
})
