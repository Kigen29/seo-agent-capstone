import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SUGGESTIONS,
  suggestVisibilityPrompts,
  type PromptSuggestionLlm,
} from '../src/suggest-prompts.js'

const fake = (prompts: { prompt: string; reason: string }[]) => {
  const object = vi.fn(async (_opts: unknown) => ({ output: { prompts } }))
  return { llm: { object } as unknown as PromptSuggestionLlm, object }
}

describe('suggestVisibilityPrompts', () => {
  it('grounds the request in the site and its market, with one smart call', async () => {
    const { llm, object } = fake([])
    await suggestVisibilityPrompts(llm, 'tenant-1', {
      url: 'https://soliangirls.sc.ke/',
      country: 'Kenya',
      title: 'Solian Girls Senior School',
      headings: ['Admissions', 'Academics'],
      topics: ['boarding', 'KCSE results'],
      brand: 'Solian Girls',
      existing: ['best girls boarding schools in kenya'],
    })
    expect(object).toHaveBeenCalledTimes(1)
    const call = object.mock.calls[0]![0] as unknown as {
      role: string
      tenantId: string
      prompt: string
    }
    expect(call.role).toBe('smart')
    expect(call.tenantId).toBe('tenant-1')
    expect(call.prompt).toContain('Market: Kenya')
    expect(call.prompt).toContain('Topics covered: boarding, KCSE results')
    expect(call.prompt).toContain('never use it in a question')
  })

  it('drops repeats, tracked questions and branded questions, and tidies the rest', async () => {
    const { llm } = fake([
      { prompt: '  Best girls   boarding schools in Kenya ', reason: 'Tracked already' },
      { prompt: 'Which Solian Girls fees apply?', reason: 'Branded' },
      {
        prompt: 'How do KCSE results compare across Nakuru schools?',
        reason: 'Comparing — results',
      },
      { prompt: 'How do KCSE results compare across Nakuru schools?', reason: 'Duplicate' },
    ])
    const out = await suggestVisibilityPrompts(llm, 't', {
      url: 'https://soliangirls.sc.ke/',
      brand: 'Solian Girls',
      existing: ['best girls boarding schools in kenya'],
    })
    expect(out).toEqual([
      {
        prompt: 'How do KCSE results compare across Nakuru schools?',
        reason: 'Comparing, results',
      },
    ])
  })

  it('never returns more than the cap', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      prompt: `Question number ${i} about schools?`,
      reason: 'Fits',
    }))
    const out = await suggestVisibilityPrompts(fake(many).llm, 't', { url: 'https://x.test' })
    expect(out).toHaveLength(MAX_SUGGESTIONS)
  })
})
