import { describe, expect, it } from 'vitest'
import { pollEngines } from '../src/visibility/poll.js'
import type { AiEngine, EngineAnswer, PollTarget } from '../src/visibility/types.js'

/** A fake engine, so the orchestration is tested without a network or a key. */
function fakeEngine(name: string, result: Partial<EngineAnswer> | Error): AiEngine {
  return {
    name,
    async ask(prompt) {
      if (result instanceof Error) throw result
      return { engine: name, prompt, answer: '', citations: [], ...result }
    },
  }
}

const target: PollTarget = { domain: 'heartbeestsafaris.com', competitors: ['rivalsafaris.com'] }

describe('pollEngines', () => {
  it('checks the citation for every engine that answers', async () => {
    const engines = [
      fakeEngine('perplexity', { citations: ['https://heartbeestsafaris.com/'] }),
      fakeEngine('ai_overview', { citations: ['https://rivalsafaris.com/'] }),
    ]

    const checks = await pollEngines(engines, 'best safari in nairobi', target)

    expect(checks).toHaveLength(2)
    expect(checks.find((c) => c.engine === 'perplexity')?.cited).toBe(true)
    expect(checks.find((c) => c.engine === 'ai_overview')?.cited).toBe(false)
  })

  it('drops an engine that fails and keeps the rest', async () => {
    const engines = [
      fakeEngine('perplexity', { citations: ['https://heartbeestsafaris.com/'] }),
      fakeEngine('flaky', new Error('rate limited')),
    ]

    const checks = await pollEngines(engines, 'best safari in nairobi', target)

    expect(checks).toHaveLength(1)
    expect(checks[0]?.engine).toBe('perplexity')
  })
})
