import { z } from 'zod'

/**
 * A drafted digital-PR email. Written by a model, sent by a human, or not at all.
 *
 * CLAUDE.md rule 6 is the whole shape of this file: we draft, humans send. There is deliberately
 * no transport here, no address book, and no queue. The function returns text. Everything that
 * would turn that text into an email is somebody's deliberate act, in their own client, under
 * their own name, and that is not a limitation to route around later. An agent that can email
 * strangers on a client's behalf is a liability the client cannot supervise.
 *
 * The second rule is that a draft has to be grounded. The research is blunt about what works:
 * one specific, true, concrete fact nobody else has. A mass template with the publication's name
 * swapped in is what every outreach tool already produces, it is why journalists ignore outreach,
 * and it is worse than nothing because it spends the client's name to no effect. So this refuses
 * to draft when it has no concrete fact to build on, rather than filling the gap with adjectives.
 */

/** The smallest slice of the LLM client this needs. `@seo/llm`'s LlmClient satisfies it. */
export interface OutreachLlm {
  object<T>(opts: {
    role: 'smart'
    tenantId: string
    schema: z.ZodType<T>
    system?: string
    prompt: string
  }): Promise<{ output: T }>
}

/**
 * A concrete, checkable fact about the client, in their own words.
 *
 * "Concrete" is doing real work here. "We are passionate about safaris" is not a fact; "we have
 * run the same 9-day Mara circuit since 2011 and publish our vehicle occupancy" is. The caller
 * supplies these from the crawl or from the client, and the model is forbidden from adding to
 * them, because an invented specific in an email to a journalist is the single most expensive
 * mistake this product could make on a client's behalf.
 */
export interface GroundingFact {
  /** The fact itself, as text. */
  claim: string
  /** Where it came from, so a human can verify it before sending. */
  sourceUrl: string
}

export interface OutreachTarget {
  /** The publication or site that might cover the client, e.g. 'nation.africa'. */
  domain: string
  /** What they already published that makes them a plausible target, when we know. */
  context?: string
}

export interface OutreachInput {
  brand: string
  siteUrl: string
  target: OutreachTarget
  facts: readonly GroundingFact[]
}

export const outreachDraftSchema = z.object({
  subject: z.string().min(10).max(120),
  /** Short on purpose. A pitch that needs 600 words is not a pitch. */
  body: z.string().min(120).max(1500),
  /** Why this publication specifically, in one line, so a human can sanity-check the targeting. */
  angle: z.string().min(20).max(300),
})

export type OutreachDraft = z.infer<typeof outreachDraftSchema>

export interface OutreachResult {
  draft: OutreachDraft
  /** Restated on the result so the UI cannot render a draft without the caveat. */
  readonly sendPolicy: 'draft-only: a human reviews and sends this'
  /** The facts the draft was built on, for the human checking it before they send. */
  groundedOn: GroundingFact[]
}

const SYSTEM =
  'You write short digital-PR pitches to journalists and editors. Rules, all of them absolute. ' +
  'Use ONLY the facts given to you; never invent a statistic, an award, a client name, a date, ' +
  'or a quote. Do not flatter the recipient. Do not describe the company as leading, premier, ' +
  'passionate, or world-class. Lead with the one concrete fact that is genuinely useful to their ' +
  'readers, not with a request. Under 200 words. Plain sentences. No em dashes.'

/**
 * Draft one outreach email for one opportunity, or refuse.
 *
 * Returns null rather than a generic pitch when there is nothing concrete to say. That refusal is
 * the feature: a pitch with no specific fact is a template, a template is what every other tool
 * sends, and sending one under a client's name costs them a relationship with that publication
 * for no gain. "We have nothing worth pitching to this outlet yet" is a true and useful answer.
 *
 * One `smart` call, schema-validated, per opportunity. Never per publication in bulk: the cost
 * discipline in CLAUDE.md is one call per fixable finding, and the honesty discipline is that a
 * draft is worth writing only where there is a real angle.
 */
export async function draftOutreach(
  input: OutreachInput,
  deps: { llm: OutreachLlm; tenantId: string },
): Promise<OutreachResult | null> {
  const facts = input.facts.filter((fact) => fact.claim.trim().length > 0)
  if (facts.length === 0) return null

  const factList = facts.map((fact) => `- ${fact.claim} (source: ${fact.sourceUrl})`).join('\n')

  let draft: OutreachDraft
  try {
    const result = await deps.llm.object({
      role: 'smart',
      tenantId: deps.tenantId,
      schema: outreachDraftSchema,
      system: SYSTEM,
      prompt:
        `Pitch ${input.brand} (${input.siteUrl}) to ${input.target.domain}.\n` +
        (input.target.context ? `They recently published: ${input.target.context}\n` : '') +
        `\nThe only facts you may use:\n${factList}\n` +
        '\nWrite the subject, the body, and one line explaining why this publication ' +
        'specifically. If the facts do not support a pitch to this publication, say so plainly ' +
        'in the angle rather than inventing a reason.',
    })
    draft = result.output
  } catch {
    /**
     * No chain configured, the model refused, or the output did not validate. Null, the same as
     * having no facts: the finding stays open with no draft attached, which is a state a human
     * can act on. A half-written or unvalidated pitch is not.
     */
    return null
  }

  return {
    draft,
    sendPolicy: 'draft-only: a human reviews and sends this',
    groundedOn: [...facts],
  }
}
