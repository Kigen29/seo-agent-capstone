'use server'

import { apiUrl } from '@/lib/session'
import { invalid, type UserError } from '@/lib/user-error'

/**
 * Run the anonymous check, from the server, for a visitor with no account.
 *
 * A server action rather than a call from the browser, for the same reason every other request in
 * this app goes out from the server: the API's address is not public (see `apiUrl`), and a browser
 * calling it directly would mean advertising the backend and adding a CORS surface for the one
 * route that is deliberately open.
 *
 * Errors come back as messages rather than exceptions, because every one of them is something the
 * visitor can act on: a URL that is not https, a site that did not answer, a daily limit reached.
 * An error page would throw that away.
 */

export interface CheckState {
  id?: string
  error?: UserError
  /** The daily limit for visitors was reached, so the page offers signing in. */
  limited?: boolean
}

export async function runCheck(_prev: CheckState, formData: FormData): Promise<CheckState> {
  const raw = String(formData.get('url') ?? '').trim()
  if (!raw) {
    return { error: invalid('Enter a web address', 'Type the page to check, like example.com.') }
  }

  // A visitor types example.com, not https://example.com. The guard refuses anything that is not
  // https, so the scheme is added here rather than rejecting a reasonable thing to type.
  const url = /^https?:\/\//i.test(raw) ? raw.replace(/^http:\/\//i, 'https://') : `https://${raw}`

  let response: Response
  try {
    response = await fetch(`${apiUrl()}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      // The API sleeps on the free tier and a cold start has been measured at 33.6 seconds
      // (ADR-0025). A shorter timeout here would turn a slow first request into a broken one.
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    return {
      error: {
        kind: 'waking',
        title: 'The checker did not answer in time',
        detail:
          'It sleeps when nobody is using it and takes up to a minute to start. Nothing is wrong with your site. Try again in a moment.',
      },
    }
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

  if (!response.ok) {
    // The API's refusals here are written for a visitor: a site that did not answer, an address
    // that is not https, a daily limit reached. They are shown as they came.
    const limited = response.status === 429
    return {
      limited,
      error: {
        kind: limited ? 'budget' : response.status >= 500 ? 'failed' : 'invalid',
        title: limited ? 'Today’s free checks are used up' : 'That page could not be checked',
        detail:
          body.message ??
          (response.status >= 500
            ? 'That is a fault on our side, not something you did. Try again in a moment.'
            : 'Check the address and try again.'),
      },
    }
  }

  return body.id
    ? { id: body.id }
    : {
        error: {
          kind: 'failed',
          title: 'The check ran, and the result could not be saved',
          detail: 'That is a fault on our side. Run it again.',
        },
      }
}
