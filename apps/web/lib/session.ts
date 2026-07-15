import { createApiClient, type ApiClient } from '@seo/api-client'
import { cookies } from 'next/headers'

/**
 * The session is an API token in an httpOnly cookie.
 *
 * httpOnly is the whole point: the token never exists in a variable JavaScript can read, so
 * an XSS in any dependency cannot exfiltrate it. It travels from the sign-in form to the
 * cookie jar and is read back only on the server.
 *
 * This is not the final sign-in story. It is a real credential and a real session, but
 * pasting a token is not something a marketer will do. Proper OAuth sign-in arrives with the
 * GitHub App in sprint 2, which we need anyway to open pull requests: the App gives us
 * "Sign in with GitHub" for free, and building a second identity provider first would be
 * work we would then delete. Recorded here rather than left as a surprise.
 */
const COOKIE = 'seo_token'

export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value
}

export async function setToken(token: string): Promise<void> {
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearToken(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

/**
 * `API_URL`, not `NEXT_PUBLIC_API_URL`, and the distinction is not cosmetic.
 *
 * Next inlines every `NEXT_PUBLIC_*` reference at **build** time, textually, including in
 * server code. So a value supplied at runtime is ignored: the binary carries whatever was
 * set when it was compiled. The end-to-end test caught this by pointing a freshly built app
 * at an API on a different port and watching it dial the old one anyway. The same bug in
 * production is a Vercel deploy that silently keeps talking to whatever API URL was set at
 * build time, which is a deeply confusing thing to debug.
 *
 * It is also the wrong kind of variable. The browser never calls the API: every request goes
 * out from a server component or a server action, with the token from an httpOnly cookie the
 * client cannot read. Marking the URL public would have advertised our backend to every
 * visitor for no reason at all.
 */
export const apiUrl = (): string => process.env.API_URL ?? 'http://localhost:4000'

/**
 * An API client bound to the signed-in tenant, or undefined if nobody is signed in.
 *
 * The web app holds no database credential and cannot reach Postgres: `@seo/db` is a
 * restricted import here and ESLint fails the build if anyone tries (ADR-0009). Everything
 * on this page came through the API, authenticated, and was scoped by row-level security on
 * the way out.
 */
export async function getClient(): Promise<ApiClient | undefined> {
  const token = await getToken()
  if (!token) return undefined

  return createApiClient({ baseUrl: apiUrl(), token, fetch: (...args) => fetch(...args) })
}
