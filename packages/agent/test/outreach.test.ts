import { describe, expect, it, vi } from 'vitest'
import { draftOutreach, type GroundingFact, type OutreachLlm } from '../src/outreach.js'

const FACTS: GroundingFact[] = [
  {
    claim: 'We have run the same 9-day Mara circuit since 2011 and publish vehicle occupancy.',
    sourceUrl: 'https://heartbeestsafaris.com/mara',
  },
]

const validDraft = {
  subject: 'Nine years of published vehicle occupancy on the Mara circuit',
  body:
    'Since 2011 we have run the same nine-day Mara circuit and published our vehicle occupancy ' +
    'figures for each departure, which almost nobody in the sector does. If that is useful for ' +
    'the piece you are working on, the numbers are all on the page linked below and I am happy ' +
    'to walk through the methodology.',
  angle: 'They cover Kenyan tourism operations and have written about crowding on the Mara.',
}

/** An LLM that returns whatever it is told to, and records what it was asked. */
const fakeLlm = (output: unknown = validDraft) => {
  const object = vi.fn(async (opts: { schema: { parse: (v: unknown) => unknown } }) => ({
    // Parse through the caller's own schema, so a fake cannot return a shape the real client
    // would have rejected. Without this the test would pass on output production never accepts.
    output: opts.schema.parse(output),
  }))
  return { llm: { object } as unknown as OutreachLlm, object }
}

const input = (facts: GroundingFact[] = FACTS) => ({
  brand: 'Heartbeest Safaris',
  siteUrl: 'https://heartbeestsafaris.com',
  target: { domain: 'nation.africa', context: 'A feature on crowding in the Mara' },
  facts,
})

describe('draftOutreach', () => {
  it('drafts a pitch and hands back the facts it was built on', async () => {
    const { llm } = fakeLlm()
    const result = await draftOutreach(input(), { llm, tenantId: 'tenant-1' })

    expect(result?.draft.subject).toBe(validDraft.subject)
    // The human who is about to send this needs to check the claims, so they travel with it.
    expect(result?.groundedOn).toEqual(FACTS)
  })

  it('never returns anything that could send the email', async () => {
    const { llm } = fakeLlm()
    const result = await draftOutreach(input(), { llm, tenantId: 'tenant-1' })

    // Rule 6, asserted rather than trusted to a comment. The result is text and a policy label;
    // there is no transport, no recipient address, and nothing to call.
    expect(result?.sendPolicy).toBe('draft-only: a human reviews and sends this')
    expect(Object.keys(result ?? {}).sort()).toEqual(['draft', 'groundedOn', 'sendPolicy'])
  })

  it('refuses to draft when there is no concrete fact, rather than writing a template', async () => {
    const { llm, object } = fakeLlm()
    const result = await draftOutreach(input([]), { llm, tenantId: 'tenant-1' })

    // The refusal is the feature. A pitch with no specific fact is the template every other tool
    // sends, and sending one under a client's name costs them the relationship for no gain.
    expect(result).toBeNull()
    // And it costs nothing: no call is made at all.
    expect(object).not.toHaveBeenCalled()
  })

  it('ignores a fact that is only whitespace, and then has nothing left to say', async () => {
    const { llm } = fakeLlm()
    const result = await draftOutreach(input([{ claim: '   ', sourceUrl: 'https://x.example' }]), {
      llm,
      tenantId: 'tenant-1',
    })

    expect(result).toBeNull()
  })

  it('gives the model the facts and their sources, and nothing else to invent from', async () => {
    const { llm, object } = fakeLlm()
    await draftOutreach(input(), { llm, tenantId: 'tenant-1' })

    const call = object.mock.calls[0]![0] as unknown as { prompt: string; system: string }
    expect(call.prompt).toContain('9-day Mara circuit')
    expect(call.prompt).toContain('https://heartbeestsafaris.com/mara')
    expect(call.prompt).toContain('nation.africa')
    // The instruction that keeps an invented statistic out of a journalist's inbox.
    expect(call.system).toContain('never invent a statistic')
  })

  it('makes exactly one call per opportunity', async () => {
    const { llm, object } = fakeLlm()
    await draftOutreach(input(), { llm, tenantId: 'tenant-1' })

    expect(object).toHaveBeenCalledTimes(1)
    expect(object.mock.calls[0]![0]).toMatchObject({ role: 'smart', tenantId: 'tenant-1' })
  })

  it('returns null rather than a half-written pitch when the output does not validate', async () => {
    // A body of three words satisfies no schema. The finding stays open with no draft attached,
    // which is a state a human can act on; an unvalidated pitch is not.
    const { llm } = fakeLlm({ subject: 'Hi', body: 'too short', angle: 'no' })
    const result = await draftOutreach(input(), { llm, tenantId: 'tenant-1' })

    expect(result).toBeNull()
  })

  it('returns null when no model chain is configured, rather than throwing into the caller', async () => {
    const llm = {
      object: vi.fn(async () => {
        throw new Error('No provider is configured for role "smart"')
      }),
    } as unknown as OutreachLlm

    await expect(draftOutreach(input(), { llm, tenantId: 'tenant-1' })).resolves.toBeNull()
  })
})
