'use server'

import type { ContributorSearch } from '@seo/api-client'
import { act, type ActionResult } from '@/lib/action'

/**
 * Run the contributor search for a site.
 *
 * A spent allowance comes back described as exactly that: the account is at its cap, which is an
 * answer about a working system and not a failure.
 */
export async function findContributors(
  siteId: string,
  niche: string,
  locale: string,
): Promise<ActionResult<ContributorSearch>> {
  return act('run that search', (api) =>
    api.findContributors(siteId, { niche, ...(locale ? { locale } : {}) }),
  )
}
