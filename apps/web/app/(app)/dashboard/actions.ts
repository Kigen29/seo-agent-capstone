'use server'

import {
  ApiRequestError,
  type BusinessProfileSettings,
  type ConnectRepoResult,
} from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { act, type ActionResult } from '@/lib/action'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { invalid, type UserError } from '@/lib/user-error'

/**
 * Add a site to audit. A bad URL comes back as a message on the same page rather than an
 * error page, because a typo is the caller's to fix, not a crash.
 */
export async function addSite(
  _prev: { error?: UserError },
  formData: FormData,
): Promise<{ error?: UserError }> {
  const rawUrl = String(formData.get('url') ?? '').trim()
  if (!rawUrl) {
    return { error: invalid('Enter a web address', 'Type the site to add, like example.com.') }
  }

  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

  const result = await act('add that site', (api) => api.addSite(url))
  if (!result.ok) return { error: result.error }

  revalidatePath('/dashboard')
  // Straight to its setup: the brand name was just read from the homepage, and the competitors
  // and questions are waiting to be suggested.
  redirect(`/onboarding?siteId=${result.data.id}&step=business`)
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
  // A missing siteId is a broken form, not a user mistake: the field is a hidden input this
  // code controls. Throw rather than no-op, so a wiring regression surfaces as an error
  // instead of a button that silently does nothing.
  if (!siteId) throw new Error('startAudit called without a siteId; the hidden field is missing.')

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
  redirect(`/audits/${auditId}`)
}

/**
 * Start the Google Search Console consent flow. Fetches a consent URL from the API (whose
 * state is signed for this tenant) and redirects the browser to Google. The token never
 * touches the browser: this runs on the server, and Google redirects back to the API's
 * callback, not here.
 */
export async function connectGoogle(): Promise<void> {
  const api = await getClient()
  if (!api) redirect('/login')

  let url: string
  try {
    url = await api.connectGoogle()
  } catch (error) {
    handleApiError(error)
    redirect('/dashboard?google=unavailable')
  }

  redirect(url)
}

/**
 * Begin connecting a repository to a site.
 *
 * Returns rather than redirects, because the outcome is a fork the client has to handle: a fresh
 * install (send the browser to GitHub) or a pick (show the accessible repos). The token stays in
 * the httpOnly cookie; only the install URL or the repo names cross to the browser.
 */
export async function beginConnectRepo(siteId: string): Promise<ActionResult<ConnectRepoResult>> {
  return act('reach GitHub', (api) => api.connectRepo(siteId))
}

/** Bind a repository the user picked to a site. */
export async function chooseRepo(
  siteId: string,
  repoFullName: string,
): Promise<ActionResult<true>> {
  // A 409 is GitHub saying the app was never granted this repository. That has a specific cure,
  // so it gets its own words rather than the general "could not".
  let noAccess = false
  const result = await act('connect that repository', async (api) => {
    try {
      await api.setSiteRepo(siteId, repoFullName)
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 409)) throw error
      noAccess = true
    }
    return true as const
  })

  if (noAccess) {
    return {
      ok: false,
      error: invalid(
        'The app cannot see that repository',
        'Grant it access on GitHub using the link below the list, then choose it again.',
      ),
    }
  }

  if (result.ok) {
    revalidatePath('/dashboard')
    revalidatePath('/site')
  }
  return result
}

/**
 * Queue the Search Console auto-verification PR for a site. The worker creates the property,
 * fetches the token, and opens a PR that adds the verification meta tag. A 409 means a
 * precondition is missing (no repo, or Google not connected), which is the user's to fix.
 */
export async function verifySite(formData: FormData): Promise<void> {
  const siteId = String(formData.get('siteId') ?? '')
  if (!siteId) throw new Error('verifySite called without a siteId; the hidden field is missing.')

  const api = await getClient()
  if (!api) redirect('/login')

  try {
    await api.verifySite(siteId)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      redirect('/dashboard?verify=precondition')
    }
    handleApiError(error)
    redirect('/dashboard?verify=failed')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?verify=queued')
}

/** The Google Business Profile connected to a site, for the panel that edits it. */
export async function loadBusinessProfile(
  siteId: string,
): Promise<ActionResult<BusinessProfileSettings>> {
  return act('load the profile', (api) => api.getBusinessProfile(siteId))
}

/**
 * Connect a business profile from a Maps share link, or clear it with null.
 *
 * The API's refusals are the useful half of this feature: "that link carries no business
 * identifier" tells somebody exactly what to do next, so its own words are what is shown.
 */
export async function saveBusinessProfile(
  siteId: string,
  mapsUrl: string | null,
): Promise<ActionResult<BusinessProfileSettings>> {
  const result = await act('save the profile', (api) => api.setBusinessProfile(siteId, mapsUrl))
  if (result.ok) {
    revalidatePath('/dashboard')
    revalidatePath('/site')
  }
  return result
}
