import { cookies } from 'next/headers'

/**
 * The site somebody typed on the landing page, carried through sign-in.
 *
 * Signing in leaves this origin for GitHub or Google and comes back, so the address cannot ride
 * in memory, and putting it in the sign-in URL would mean threading it through two other
 * companies' redirects. A short-lived cookie on our own origin survives the trip and is read once,
 * by the first step of onboarding.
 *
 * It holds a web address and nothing else: no account exists yet when it is written, and it is
 * never trusted as more than a suggestion for a text field the person can still change.
 */
const COOKIE = 'rw_pending_site'

/** Long enough to sign in, short enough that a stale address does not greet somebody next week. */
const ONE_HOUR = 60 * 60

/** A bare host, or a host with a path. Anything else is not remembered. */
const LOOKS_LIKE_A_SITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i

export function tidySiteAddress(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.length > 300 || !LOOKS_LIKE_A_SITE.test(value)) return null
  return value
}

export async function rememberPendingSite(address: string): Promise<void> {
  ;(await cookies()).set(COOKIE, address, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_HOUR,
  })
}

export async function readPendingSite(): Promise<string | undefined> {
  const value = (await cookies()).get(COOKIE)?.value
  return value ? (tidySiteAddress(value) ?? undefined) : undefined
}

export async function forgetPendingSite(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}
