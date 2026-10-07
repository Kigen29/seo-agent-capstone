'use server'

import { ApiRequestError } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClient } from '@/lib/session'

export async function saveHosting(_state: { message: string; ok: boolean }, form: FormData) {
  const api = await getClient()
  if (!api) return { message: 'Please sign in again.', ok: false }
  const siteId = String(form.get('siteId') ?? '')
  try {
    if (form.get('operation') === 'disconnect') await api.disconnectHosting(siteId)
    else
      await api.connectHosting(siteId, {
        token: String(form.get('token') ?? ''),
        ...(String(form.get('projectId') ?? '').trim()
          ? { projectId: String(form.get('projectId')).trim() }
          : {}),
        ...(form.get('teamId') ? { teamId: String(form.get('teamId')).trim() } : {}),
      })
    revalidatePath('/settings/connections/hosting')
    return {
      message:
        form.get('operation') === 'disconnect'
          ? 'Disconnected, and the saved token is deleted. Fixes can still be verified through GitHub deployment reports.'
          : 'Connected. Merged fixes for this site will now be checked against this project.',
      ok: true,
    }
  } catch (error) {
    return {
      message:
        error instanceof ApiRequestError && [400, 409, 422].includes(error.status)
          ? error.message
          : 'That did not go through. Nothing was changed. Try again in a minute.',
      ok: false,
    }
  }
}

/**
 * Send the browser to Vercel's consent screen for this site.
 *
 * `redirect` is called outside the try, because it signals by throwing and must not be read as a
 * failure to start.
 */
export async function connectVercel(form: FormData) {
  const siteId = String(form.get('siteId') ?? '')
  const api = await getClient()
  if (!api) redirect('/login')

  let url: string
  try {
    url = await api.startVercelConnect(siteId)
  } catch {
    redirect(`/settings/connections/hosting?siteId=${siteId}&vercel=failed`)
  }
  redirect(url)
}
