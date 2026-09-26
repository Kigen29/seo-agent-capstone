'use server'

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
