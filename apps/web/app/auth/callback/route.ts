import { exchangeAuthCode } from '@seo/api-client'
import { safeNext } from '@seo/core'
import { NextResponse, type NextRequest } from 'next/server'
import { apiUrl, setToken } from '@/lib/session'

/**
 * Where a social sign-in lands, and the only place the handoff code is ever spent.
 *
 * A route handler rather than a page, because nothing here renders: it redeems a code, sets a
 * cookie and redirects. A page would mean a flash of markup the user sees for no reason.
 *
 * The exchange happens **server to server**. The browser arrives carrying a code that is worth
 * nothing on its own, this server posts it to the API, and the session token comes back in a
 * response body and goes straight into an httpOnly cookie. The token never touches a URL, never
 * reaches browser history, and never exists in anything client JavaScript can read.
 *
 * The code is spent here whatever happens next. It is single use at the API, so a reload of this
 * URL, which is exactly what a user does when something looks stuck, cannot mint a second
 * session; it fails and sends them back to sign in again.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = request.nextUrl.searchParams.get('next')

  const origin = request.nextUrl.origin
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, origin))

  if (!code) return fail('declined')

  let token: string | undefined
  try {
    token = await exchangeAuthCode(apiUrl(), code)
  } catch {
    /*
      The API sleeps on the free tier, and this is the worst possible moment for it.

      The user has just consented at GitHub or Google and is watching a blank redirect. A generic
      failure here reads as "the sign-in did not work"; the truth is that the code expires in two
      minutes and a cold start can eat most of that, so the honest instruction is to try again.
    */
    return fail('api_asleep')
  }

  if (!token) return fail('expired')

  await setToken(token)

  // Only a path, and never one starting with two slashes: `//evil.example` is a
  // protocol-relative URL a browser resolves to another origin. The API checks this too; doing
  // it on both sides means neither has to trust the other to have done it.
  const target = safeNext(next) ?? '/dashboard'

  return NextResponse.redirect(new URL(target, origin))
}
