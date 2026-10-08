'use server'

import type { CompetitorSuggestions, PromptSuggestions, SiteProfile } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { act, type ActionResult } from '@/lib/action'

/**
 * A site's own details, saved from the site page and from onboarding.
 *
 * Every action returns an `ActionResult`, so a failure reaches the screen described and in one
 * shape, whichever form raised it.
 */

const refresh = () => {
  revalidatePath('/site')
  revalidatePath('/competitors')
  revalidatePath('/dashboard')
}

export async function saveProfile(
  siteId: string,
  profile: { brand: string; offering: string; market: string },
): Promise<ActionResult<SiteProfile>> {
  const result = await act('save these details', (api) => api.saveSiteProfile(siteId, profile))
  if (result.ok) refresh()
  return result
}

export async function saveCompetitors(
  siteId: string,
  competitors: string[],
): Promise<ActionResult<string[]>> {
  const result = await act('save your competitors', (api) =>
    api.saveCompetitors(siteId, competitors),
  )
  if (result.ok) refresh()
  return result
}

export async function suggestCompetitors(
  siteId: string,
): Promise<ActionResult<CompetitorSuggestions>> {
  return act('suggest competitors', (api) => api.suggestCompetitors(siteId))
}

/** The questions the agent would track, for the onboarding step that offers them. */
export async function suggestQuestions(siteId: string): Promise<ActionResult<PromptSuggestions>> {
  return act('suggest questions', (api) => api.suggestPrompts(siteId))
}

/** Add questions to the ones already tracked. Never removes any. */
export async function addQuestions(
  siteId: string,
  questions: string[],
): Promise<ActionResult<{ tracked: number }>> {
  const result = await act('save your questions', async (api) => {
    const current = await api.getVisibility(siteId)
    const merged = [...new Set([...current.prompts, ...questions])]
    const saved = await api.setVisibility(siteId, { ...current, prompts: merged })
    return { tracked: saved.prompts.length }
  })
  if (result.ok) {
    revalidatePath('/visibility')
    revalidatePath('/dashboard')
  }
  return result
}

/** Set the name a tracked competitor goes by, or clear it. Returns every name as now stored. */
export async function saveCompetitorName(
  siteId: string,
  domain: string,
  name: string | null,
): Promise<ActionResult<Record<string, string | null>>> {
  return act('save that name', (api) => api.saveCompetitorName(siteId, domain, name))
}
