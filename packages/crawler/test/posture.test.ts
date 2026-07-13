import { describe, expect, it } from 'vitest'
import { evaluateAiCrawlerPosture } from '../src/robots/posture.js'
import { ALLOW_ALL } from '../src/robots/parse.js'
import { loadRobots } from './fixtures.js'

const tokens = (agents: { token: string }[]) => agents.map((a) => a.token).sort()

describe('evaluateAiCrawlerPosture', () => {
  it('catches the copy-pasted AI block: the site has deleted itself from ChatGPT', () => {
    const posture = evaluateAiCrawlerPosture(loadRobots('copy-pasted-ai-block'))

    expect(tokens(posture.blockedSearchAgents)).toEqual(['OAI-SearchBot', 'PerplexityBot'])
    expect(posture.looksLikeCopyPastedAiBlock).toBe(true)
  })

  it('does not flag a site that blocks training but keeps search crawlers', () => {
    // This is what the previous site almost certainly meant to do. It must not
    // produce a critical finding, or we cry wolf on the highest-severity rule we ship.
    const posture = evaluateAiCrawlerPosture(loadRobots('sensible-ai-posture'))

    expect(posture.blockedSearchAgents).toEqual([])
    expect(posture.looksLikeCopyPastedAiBlock).toBe(false)
    expect(tokens(posture.blockedTrainingAgents)).toEqual(['CCBot', 'ClaudeBot', 'GPTBot'])
  })

  it('does not treat Google-Extended as a visibility problem, because it is not one', () => {
    // Google-Extended opts you out of Gemini training. It does not touch Search
    // ranking or AI Overviews, which run on the regular index. Reporting it as lost
    // visibility would be exactly the vendor nonsense the product exists to refuse.
    const posture = evaluateAiCrawlerPosture(loadRobots('sensible-ai-posture'))
    const googleExtended = posture.verdicts.find((v) => v.agent.token === 'Google-Extended')

    expect(googleExtended?.allowed).toBe(false)
    expect(googleExtended?.agent.category).toBe('opt_out')
    expect(posture.blockedSearchAgents).toEqual([])
  })

  it('flags nothing on a site with no robots.txt at all', () => {
    const posture = evaluateAiCrawlerPosture(ALLOW_ALL)

    expect(posture.blockedSearchAgents).toEqual([])
    expect(posture.blockedTrainingAgents).toEqual([])
    expect(posture.verdicts.every((v) => v.allowed)).toBe(true)
  })

  it('does not flag a Cloudflare managed file, which signals intent without blocking', () => {
    // Content-Signal: ai-train=no expresses a preference. It is not an access control,
    // and it must not be reported as though the site had blocked anything.
    const posture = evaluateAiCrawlerPosture(loadRobots('cloudflare-content-signals'))

    expect(posture.blockedSearchAgents).toEqual([])
    expect(tokens(posture.blockedTrainingAgents)).toEqual(['Bytespider'])
  })
})
