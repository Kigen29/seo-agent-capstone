'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { act, type ActionResult } from '@/lib/action'
import { forgetPendingSite, rememberPendingSite, tidySiteAddress } from '@/lib/pending-site'
import { invalid } from '@/lib/user-error'

/**
 * The landing page's "start with your site" form.
 *
 * Nobody is signed in yet, so nothing is created: the address is remembered and the person is
 * sent to onboarding, which sends them to sign in and brings them back to a first step that is
 * already filled in. An address that does not look like one is dropped without complaint, since
 * the same field is waiting for them after sign-in, where it can be explained properly.
 */
export async function startWithSite(formData: FormData): Promise<void> {
  const address = tidySiteAddress(String(formData.get('url') ?? ''))
  if (address) await rememberPendingSite(address)
  redirect('/onboarding')
}

/** Add the site this account is about. The API reads its homepage and captures the brand name. */
export async function createSite(rawUrl: string): Promise<ActionResult<{ siteId: string }>> {
  const address = tidySiteAddress(rawUrl)
  if (!address) {
    return {
      ok: false,
      error: invalid(
        'That is not a web address',
        'Give the address people type to reach your site, like example.com.',
      ),
    }
  }

  const url = /^https?:\/\//i.test(address) ? address : `https://${address}`
  const result = await act('add your site', async (api) => ({
    siteId: (await api.addSite(url)).id,
  }))

  if (result.ok) {
    await forgetPendingSite()
    revalidatePath('/dashboard')
  }
  return result
}
