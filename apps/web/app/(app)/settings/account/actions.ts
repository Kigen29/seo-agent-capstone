'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { handleApiError } from '@/lib/api-error'
import { clearToken, getClient } from '@/lib/session'

const ACCOUNT = '/settings/account'

/**
 * Revoke one session or token.
 *
 * Revoking the credential this browser is using is a sign-out, so the cookie goes too and the
 * person lands on the login page rather than on a settings page that now answers 401. The
 * `current` field only chooses where to go afterwards; the API decides what is revoked.
 */
export async function revokeCredential(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  // A hidden field this code renders. Missing means a broken form, so fail loudly.
  if (!id) throw new Error('revokeCredential called without an id; the hidden field is missing.')
  const current = formData.get('current') === 'true'

  const api = await getClient()
  if (!api) redirect('/login')

  try {
    await api.revokeCredential(id)
  } catch (error) {
    handleApiError(error)
    redirect(`${ACCOUNT}?asleep=1`)
  }

  if (current) {
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
