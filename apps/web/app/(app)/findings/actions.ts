'use server'

import { redirect } from 'next/navigation'
import { getClient } from '@/lib/session'

/**
 * Ask the agent for a pull request for each of a site's most important fixable findings.
 *
 * The same shape as the single Fix action: a plain form, a server action, and the outcome carried
 * back in the address so the page can say what happened without client state. `redirect` is
 * called outside the try, because it signals by throwing and must not be read as a failure.
 */
export async function openFixPrs(formData: FormData) {
  const siteId = String(formData.get('siteId') ?? '')
  if (!siteId) return

  const api = await getClient()
  if (!api) redirect('/login')

  const outcome = new URLSearchParams({ siteId })
  try {
    const result = await api.fixSiteFindings(siteId)
    outcome.set('bulk', 'done')
    outcome.set('queued', String(result.queued.length))
    outcome.set('skipped', String(result.skipped.length))
    outcome.set('remaining', String(result.remaining))
    // One reason is enough to act on, and an address is not the place for ten.
    if (result.skipped[0]) outcome.set('why', result.skipped[0].reason.slice(0, 200))
  } catch {
    outcome.set('bulk', 'failed')
  }

  redirect(`/findings?${outcome.toString()}`)
}
