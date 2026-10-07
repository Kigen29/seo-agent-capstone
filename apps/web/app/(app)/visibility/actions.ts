'use server'

import type { MinedQuestions, PromptSuggestions, VisibilitySettings } from '@seo/api-client'
import { ApiRequestError } from '@seo/api-client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { act, type ActionResult } from '@/lib/action'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

/** Questions the agent drafts from the site itself, so nobody has to write them. */
export async function suggestPrompts(
  siteId: string,
): Promise<PromptSuggestions | { error: string }> {
  const api = await getClient()
  if (!api) redirect('/login')

  try {
    return await api.suggestPrompts(siteId)
  } catch (error) {
    // 429 (budget spent), 503 (no model) and 502 (model did not answer) all carry a message a
    // person can act on, so it is shown as it came.
    if (error instanceof ApiRequestError && [429, 502, 503].includes(error.status)) {
      return { error: error.message }
    }
    handleApiError(error)
    return { error: 'Could not draft questions. The API may be waking up; try again shortly.' }
  }
}

/** The questions this site's customers ask, from Search Console and optionally People Also Ask. */
export async function mineQuestions(
  siteId: string,
  seed: string,
): Promise<MinedQuestions | { error: string }> {
  const api = await getClient()
  if (!api) redirect('/login')

  try {
    return await api.mineQuestions(siteId, seed ? { seed } : {})
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 429) {
      return { error: error.message }
    }
    handleApiError(error)
    return { error: 'Could not look for questions. The API may be waking up; try again shortly.' }
  }
}

/**
 * Start tracking some mined questions, keeping the ones already tracked.
 *
 * Read, merge, write, rather than a write of the new list alone. Every tracked prompt owns its
 * poll history, and a citation verdict needs three checks across three days: replacing the list
 * would throw away windows somebody has already waited for. The API's save is itself a diff, so a
 * question that survives this merge keeps its row and its checks.
 */
export async function addPrompts(
  siteId: string,
  questions: string[],
): Promise<VisibilitySettings | { error: string }> {
  const api = await getClient()
  if (!api) redirect('/login')

  try {
    const current = await api.getVisibility(siteId)
    const existing = new Set(current.prompts.map((prompt) => prompt.trim().toLowerCase()))
    const additions = questions.filter((question) => !existing.has(question.trim().toLowerCase()))

    const saved = await api.setVisibility(siteId, {
      ...current,
      prompts: [...current.prompts, ...additions],
    })

    revalidatePath('/visibility')
    return saved
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 400) {
      // The cap on tracked prompts is the usual reason, and it is a real answer: every prompt is a
      // poll a day forever, so the limit is a cost ceiling rather than a technical one.
      return { error: error.message }
    }
    handleApiError(error)
    return { error: 'Could not save the questions. Try again shortly.' }
  }
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
