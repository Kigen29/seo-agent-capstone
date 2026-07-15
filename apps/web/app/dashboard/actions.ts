'use server'

import { ApiRequestError } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

/**
 * Add a site to audit. A bad URL comes back as a message on the same page rather than an
 * error page, because a typo is the caller's to fix, not a crash.
 */
export async function addSite(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const rawUrl = String(formData.get('url') ?? '').trim()
  if (!rawUrl) return { error: 'Enter a site URL.' }

  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

  const api = await getClient()
  if (!api) redirect('/login')

  try {
    await api.addSite(url)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 400) {
      return { error: 'That does not look like a valid URL.' }
    }
    handleApiError(error)
    return { error: 'Could not reach the API. It may be waking up; try again shortly.' }
  }

  revalidatePath('/dashboard')
  return {}
}

/**
 * Queue an audit and go straight to its page, where the live progress takes over.
 *
 * A server action, so the API token in the httpOnly cookie never touches the browser. The
 * redirect lands the user on the audit's page immediately, showing "queued" and then the
 * moving page count as the worker picks it up; there is nothing to wait for here.
 */
export async function startAudit(formData: FormData): Promise<void> {
  const siteId = String(formData.get('siteId') ?? '')
  if (!siteId) return

  const api = await getClient()
  if (!api) redirect('/login')

  let auditId: string
  try {
    auditId = await api.startAudit(siteId)
  } catch (error) {
    handleApiError(error)
    // handleApiError only returns for the API-is-waking case; surface that on the dashboard.
    redirect('/dashboard?asleep=1')
  }

  revalidatePath('/dashboard')
  redirect(`/dashboard/audits/${auditId}`)
}
