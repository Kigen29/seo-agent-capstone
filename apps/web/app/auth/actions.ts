'use server'

import { redirect } from 'next/navigation'
import { clearToken, getClient } from '@/lib/session'

/**
 * Sign out on the server as well as in the browser.
 *
 * Clearing the cookie is what the user sees; revoking the token is what actually ends the
 * session. Without the revoke, a token captured beforehand keeps working for the full thirty days
 * of the cookie's life, which is not what anyone means by signing out.
 *
 * The revoke is best-effort and the cookie is cleared regardless. If the API is asleep, the
 * correct outcome is still that this browser is signed out; refusing to sign out because the
 * server did not answer would leave the user staring at a dashboard they asked to leave.
 */
export async function signOut(): Promise<void> {
  const api = await getClient()

  try {
    await api?.signOut()
  } catch {
    // Best-effort. The cookie goes either way.
  }

  await clearToken()
  redirect('/login')
}
