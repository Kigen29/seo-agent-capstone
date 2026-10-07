'use server'

import type { MinedQuestions, PromptSuggestions, VisibilitySettings } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { act, type ActionResult } from '@/lib/action'

/** Questions the agent drafts from the site itself, so nobody has to write them. */
export async function suggestPrompts(siteId: string): Promise<ActionResult<PromptSuggestions>> {
  return act('draft questions', (api) => api.suggestPrompts(siteId))
}

/** The questions this site's customers ask, from Search Console and optionally People Also Ask. */
export async function mineQuestions(
  siteId: string,
  seed: string,
): Promise<ActionResult<MinedQuestions>> {
  return act('look for questions', (api) => api.mineQuestions(siteId, seed ? { seed } : {}))
}

/**
 * Start tracking some mined questions, keeping the ones already tracked.
 *
 * Read, merge, write, rather than a write of the new list alone. Every tracked prompt owns its
 * poll history, and a citation verdict needs three checks across three days: replacing the list
 * would throw away windows somebody has already waited for. The API's save is itself a diff, so a
 * question that survives this merge keeps its row and its checks.
 *
 * The cap on tracked questions is the usual refusal, and the API says so in its own words: every
 * question is a check a day, so the limit is a cost ceiling and not a technical one.
 */
export async function addPrompts(
  siteId: string,
  questions: string[],
): Promise<ActionResult<VisibilitySettings>> {
  const result = await act('save those questions', async (api) => {
    const current = await api.getVisibility(siteId)
    const existing = new Set(current.prompts.map((prompt) => prompt.trim().toLowerCase()))
    const additions = questions.filter((question) => !existing.has(question.trim().toLowerCase()))

    return api.setVisibility(siteId, {
      ...current,
      prompts: [...current.prompts, ...additions],
    })
  })
  if (result.ok) revalidatePath('/visibility')
  return result
}

/** The tracked questions, for the editor. */
export async function loadQuestions(siteId: string): Promise<ActionResult<string[]>> {
  return act('load your questions', async (api) => (await api.getVisibility(siteId)).prompts)
}

/**
 * Replace the tracked questions and leave the brand and the competitors as they are.
 *
 * The API stores all three in one call, so this reads them first and sends the other two back
 * unchanged. Returns what was stored, which may be tidier than what was typed.
 */
export async function saveQuestions(
  siteId: string,
  prompts: string[],
): Promise<ActionResult<string[]>> {
  const result = await act('save your questions', async (api) => {
    const current = await api.getVisibility(siteId)
    return (await api.setVisibility(siteId, { ...current, prompts })).prompts
  })
  if (result.ok) {
    revalidatePath('/visibility')
    revalidatePath('/dashboard')
  }
  return result
}
