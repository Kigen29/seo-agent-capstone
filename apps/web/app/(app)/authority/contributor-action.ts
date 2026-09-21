'use server'

import { ApiRequestError, type ContributorSearch } from '@seo/api-client'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

/**
 * Run the contributor search for a site.
 *
 * A 429 is the budget guard doing its job and comes back as its own message: the tenant is at its
 * cap, which is a quota answer about a working system rather than a failure.
 */
export async function findContributors(
  siteId: string,
  niche: string,
  locale: string,
): Promise<ContributorSearch | { error: string }> {
  const api = await getClient()
  if (!api) return { error: 'Sign in again to run this.' }

  try {
    return await api.findContributors(siteId, {
      niche,
      ...(locale ? { locale } : {}),
    })
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 429 || error.status === 400)) {
      return { error: error.message }
    }
    handleApiError(error)
    return { error: 'Could not run the search. The API may be waking up; try again shortly.' }
  }
}
