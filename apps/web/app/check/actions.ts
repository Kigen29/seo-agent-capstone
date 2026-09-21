'use server'

import { apiUrl } from '@/lib/session'

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
  error?: string
}

export async function runCheck(_prev: CheckState, formData: FormData): Promise<CheckState> {
  const raw = String(formData.get('url') ?? '').trim()
  if (!raw) return { error: 'Paste a URL first.' }

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
      error:
        'The checker did not answer. It sleeps when nobody is using it and can take a minute to ' +
        'wake up, so this is usually worth one retry.',
    }
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

  if (!response.ok) {
    return { error: body.message ?? 'That check could not be run.' }
  }

  return body.id ? { id: body.id } : { error: 'The check ran but could not be saved.' }
}
