import { z } from 'zod'

/**
 * Propose the questions this business should be tracked on in AI answer engines.
 *
 * The AI-visibility axis measures whether ChatGPT, Perplexity and Google's AI answers cite a site
 * when a customer asks about its field. It needs a list of those questions, and asking a busy
 * owner to write them was the wrong way round: the product already knows the site's title,
 * description, headings and topic clusters. This drafts the list; a person ticks what to track.
 *
 * This is generation, not detection (ADR-0001): nothing here decides whether the site has a
 * problem. It only drafts inputs a human approves, and every call goes through the budget guard.
 *
 * What makes a question worth tracking comes from the citation research in CLAUDE.md:
 *   - Geographic scope matching is the strongest predictor of a stable citation, so a Kenyan
 *     school is tracked on questions a Kenyan parent asks, not global ones.
 *   - Unbranded questions. "Best girls' secondary schools in Nakuru" is a contest the site can win
 *     or lose; "What is Solian Girls?" measures nothing.
 *   - Natural phrasing, the way a person types into an assistant, across intents: choosing,
 *     comparing, cost, how-to.
 */

export interface PromptSuggestionLlm {
  object<T>(opts: {
    role: 'smart'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
  }): Promise<{ output: T }>
}

export interface SiteContext {
  url: string
  /** The market the site serves, as a country name, when its domain says. */
  country?: string
  title?: string | null
  description?: string | null
  headings?: string[]
  /** Topic cluster names from the latest audit. */
  topics?: string[]
  brand?: string | null
  /** Questions already tracked, so the draft does not repeat them. */
  existing?: string[]
}

export interface SuggestedPrompt {
  prompt: string
  /** One line on why this question fits the business, shown next to it. */
  reason: string
}

export const MAX_SUGGESTIONS = 8

const suggestionSchema = z.object({
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(10).max(200),
        reason: z.string().min(3).max(200),
      }),
    )
    .max(12),
})

const SYSTEM = [
  'You draft the questions a real potential customer would type into an AI assistant',
  '(ChatGPT, Perplexity, Google AI Mode) when looking for what this business offers.',
  'Rules:',
  '- Match the business geography. If it serves one country or city, the questions name it.',
  '- Never include the business name or brand. Track the contest, not the brand.',
  '- Natural, specific phrasing a person would actually use. No keyword strings.',
  '- Cover different intents: choosing, comparing, cost, practical how-to.',
  '- Only questions this business could credibly be cited for, based on the context given.',
  '- Each reason is one short sentence, plain English, no em dashes.',
].join('\n')

function describe(context: SiteContext): string {
  const lines = [`Website: ${context.url}`]
  if (context.country) lines.push(`Market: ${context.country}`)
  if (context.title) lines.push(`Page title: ${context.title}`)
  if (context.description) lines.push(`Description: ${context.description}`)
  if (context.headings?.length) lines.push(`Headings: ${context.headings.slice(0, 15).join(' | ')}`)
  if (context.topics?.length)
    lines.push(`Topics covered: ${context.topics.slice(0, 15).join(', ')}`)
  if (context.brand) lines.push(`Brand (never use it in a question): ${context.brand}`)
  if (context.existing?.length)
    lines.push(`Already tracked (do not repeat): ${context.existing.join(' | ')}`)
  lines.push(`Draft up to ${MAX_SUGGESTIONS} questions.`)
  return lines.join('\n')
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

export async function suggestVisibilityPrompts(
  llm: PromptSuggestionLlm,
  tenantId: string,
  context: SiteContext,
): Promise<SuggestedPrompt[]> {
  const { output } = await llm.object({
    role: 'smart',
    tenantId,
    schema: suggestionSchema,
    system: SYSTEM,
    prompt: describe(context),
  })

  // The model is told these rules; the code enforces the ones it can check, so a stray answer
  // never reaches the list a person approves.
  const brand = context.brand?.trim().toLowerCase()
  const seen = new Set((context.existing ?? []).map((prompt) => normalise(prompt).toLowerCase()))
  const kept: SuggestedPrompt[] = []
  for (const entry of output.prompts) {
    const prompt = normalise(entry.prompt)
    const key = prompt.toLowerCase()
    if (seen.has(key)) continue
    if (brand && brand.length > 2 && key.includes(brand)) continue
    seen.add(key)
    kept.push({ prompt, reason: normalise(entry.reason.replace(/\s*—\s*/g, ', ')) })
    if (kept.length === MAX_SUGGESTIONS) break
  }
  return kept
}
