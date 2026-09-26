import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRICES_VERIFIED_ON, PRICING } from '../src/pricing.js'

describe('the price table', () => {
  it('never prices a model at zero input, so the budget guard always meters it', () => {
    for (const [model, price] of Object.entries(PRICING)) {
      expect(price.inputPerMTok, model).toBeGreaterThan(0)
    }
  })

  it('prices output for every model except embeddings, which have none', () => {
    for (const [model, price] of Object.entries(PRICING)) {
      if (model.includes('embedding')) expect(price.outputPerMTok, model).toBe(0)
      else expect(price.outputPerMTok, model).toBeGreaterThan(0)
    }
  })

  it('has a price for every model the documented role chains name', () => {
    // .env.example is what a new deployment copies. A chain naming an unpriced model would make
    // that role refuse every call as soon as the chain reached it.
    const env = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
    const targets = [...env.matchAll(/^LLM_[A-Z]+=(.*)$/gm)]
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((target) => target.trim())
      .filter(Boolean)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) expect(PRICING[target], target).toBeDefined()
  })

  it('records when the prices were last checked against the vendors', () => {
    expect(PRICES_VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(PRICES_VERIFIED_ON))).toBe(false)
  })
})
