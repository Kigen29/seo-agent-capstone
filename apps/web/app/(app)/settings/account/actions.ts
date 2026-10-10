'use server'

import type { CreatedToken } from '@seo/api-client'
import { act, type ActionResult } from '@/lib/action'
import { ApiRequestError } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { handleApiError } from '@/lib/api-error'
import { clearToken, getClient } from '@/lib/session'

const ACCOUNT = '/settings/account'

/**
 * Revoke one session or token.
 *
 * Revoking the credential this browser is using is a sign-out, so the cookie goes too and the
 * person lands on the login page rather than on a settings page that now answers 401. Whether
 * that happened is asked of the API after the revoke, never read from the form: a stale or edited
 * form must not leave a dead cookie behind, or sign someone out who revoked a different row.
 */
export async function revokeCredential(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  // A hidden field this code renders. Missing means a broken form, so fail loudly.
  if (!id) throw new Error('revokeCredential called without an id; the hidden field is missing.')

  const api = await getClient()
  if (!api) redirect('/login')

  try {
    await api.revokeCredential(id)
  } catch (error) {
    handleApiError(error)
    redirect(`${ACCOUNT}?asleep=1`)
  }

  if (await ownCredentialRevoked(api)) {
    await clearToken()
    redirect('/login')
  }
  revalidatePath(ACCOUNT)
  redirect(`${ACCOUNT}?revoked=1`)
}

/** Sign out everywhere except this browser. */
/**
 * Start a checkout for a paid plan and send the browser to the payment page.
 *
 * Nothing here changes the plan. The account moves when the payment rail's signed webhook reaches
 * the API, which is the only evidence that somebody actually paid; the browser arriving back on
 * this page proves nothing, since anybody can type that address.
 *
 * Only an https address is followed. The address comes from our own API, which got it from the
 * rail, and a redirect is still the last place to trust a string without looking at it.
 */
export async function choosePlan(formData: FormData): Promise<void> {
  const planId = String(formData.get('planId') ?? '')
  if (!planId) throw new Error('choosePlan called without a planId; the hidden field is missing.')

  const api = await getClient()
  if (!api) redirect('/login')

  let url: string
  try {
    url = await api.startCheckout(planId)
  } catch (error) {
    handleApiError(error)
    redirect(`${ACCOUNT}?billing=failed`)
  }

  if (!url.startsWith('https://')) redirect(`${ACCOUNT}?billing=failed`)
  redirect(url)
}

export async function revokeOtherCredentials(): Promise<void> {
  const api = await getClient()
  if (!api) redirect('/login')

  let revoked: number
  try {
    revoked = await api.revokeOtherCredentials()
  } catch (error) {
    handleApiError(error)
    redirect(`${ACCOUNT}?asleep=1`)
  }

  revalidatePath(ACCOUNT)
  redirect(`${ACCOUNT}?revoked=${revoked}`)
}

/** True when this browser's own credential no longer authenticates, which only the API knows. */
async function ownCredentialRevoked(
  api: NonNullable<Awaited<ReturnType<typeof getClient>>>,
): Promise<boolean> {
  try {
    await api.listCredentials()
    return false
  } catch (error) {
    // Anything but a 401 (a sleeping API, say) is not evidence of a sign-out; keep the cookie.
    return error instanceof ApiRequestError && error.status === 401
  }
}

/**
 * Make a token for an editor or the command line. The value comes back once, to be shown once.
 *
 * Returned to the browser and never put in the address or a cookie: a token in a URL is a token
 * in a history file and a server log.
 */
export async function createToken(
  name: string,
  expiresInDays: number,
): Promise<ActionResult<CreatedToken>> {
  const result = await act('create that token', (api) => api.createToken({ name, expiresInDays }))
  if (result.ok) revalidatePath(ACCOUNT)
  return result
}
