'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { act } from '@/lib/action'
import { getClient } from '@/lib/session'
import type { UserError } from '@/lib/user-error'

/** What the hosting form shows after a save: a confirmation, or one described failure. */
export interface HostingState {
  saved?: string
  error?: UserError
}

export async function saveHosting(_state: HostingState, form: FormData): Promise<HostingState> {
  const siteId = String(form.get('siteId') ?? '')
  const disconnect = form.get('operation') === 'disconnect'
  const projectId = String(form.get('projectId') ?? '').trim()
  const teamId = String(form.get('teamId') ?? '').trim()

  const result = await act(disconnect ? 'disconnect hosting' : 'connect hosting', async (api) => {
    if (disconnect) await api.disconnectHosting(siteId)
    else
      await api.connectHosting(siteId, {
        token: String(form.get('token') ?? ''),
        ...(projectId ? { projectId } : {}),
        ...(teamId ? { teamId } : {}),
      })
    return true
  })

  if (!result.ok) return { error: result.error }

  revalidatePath('/settings/connections/hosting')
  return {
    saved: disconnect
      ? 'Disconnected, and the saved token is deleted. Fixes can still be verified through GitHub deployment reports.'
      : 'Connected. Merged fixes for this site will now be checked against this project.',
  }
}

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
