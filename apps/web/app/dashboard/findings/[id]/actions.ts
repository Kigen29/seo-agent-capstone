'use server'

import { redirect } from 'next/navigation'
import { getClient } from '@/lib/session'

/**
 * Ask the agent to open a pull request that fixes this finding.
 *
 * A server action, so the button is a plain form that works without client JavaScript, the same
 * shape as the dashboard's connect-repo and verify actions. The API does the authoritative
 * precondition checks (fixable, not already open, a repo connected) and this reflects the outcome
 * back onto the finding page as a banner. `redirect` is called outside the try, because it signals
 * by throwing and must not be swallowed as a failure.
 */
export async function openFixPr(formData: FormData) {
  const id = String(formData.get('findingId') ?? '')
  if (!id) return

  const api = await getClient()
  if (!api) redirect('/login')

  let status = 'queued'
  try {
    await api.fixFinding(id)
  } catch {
    status = 'failed'
  }

  redirect(`/dashboard/findings/${id}?fix=${status}`)
}
