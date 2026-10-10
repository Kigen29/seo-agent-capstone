import { describe, expect, it } from 'vitest'
import {
  engineNames,
  formatDay,
  formatDayTime,
  formatMonth,
  formatUtcDay,
  hostOf,
  plural,
} from './format'

describe('formatDay and formatDayTime', () => {
  it('write the day unambiguously, month as a word', () => {
    expect(formatDay('2026-10-11T09:05:00Z')).toBe('11 Oct 2026')
  })

  it('never write a date as digits and slashes, which reads two ways', () => {
    expect(formatDay('2026-10-11T09:05:00Z')).not.toMatch(/\d+\/\d+/)
    expect(formatDayTime('2026-10-11T09:05:00Z')).not.toMatch(/\d+\/\d+/)
  })

  it('add the time on a 24 hour clock when the time matters', () => {
    expect(formatDayTime(new Date(2026, 9, 11, 14, 5))).toBe('11 Oct 2026, 14:05')
  })

  it('take a string, a number or a date', () => {
    const moment = new Date(2026, 0, 2, 12)
    expect(formatDay(moment.toISOString())).toBe(formatDay(moment))
    expect(formatDay(moment.getTime())).toBe(formatDay(moment))
  })
})

describe('formatUtcDay and formatMonth', () => {
  it('print a UTC day as that day, whatever zone the reader is in', () => {
    // 10 October 2026 is a Saturday. Read in a zone west of Greenwich, a naive format says the 9th.
    expect(formatUtcDay('2026-10-10')).toBe('Sat 10 Oct')
    expect(formatUtcDay('2026-01-01')).toBe('Thu 1 Jan')
  })

  it('name a month in full', () => {
    expect(formatMonth('2026-10')).toBe('October 2026')
    expect(formatMonth('2027-01')).toBe('January 2027')
  })
})

describe('hostOf', () => {
  it('gives the name a person would call the site', () => {
    expect(hostOf('https://www.example.com/pricing?x=1')).toBe('example.com')
    expect(hostOf('http://shop.example.co.ke')).toBe('shop.example.co.ke')
  })

  it('returns what was stored when it is not an address, rather than nothing', () => {
    expect(hostOf('not a site')).toBe('not a site')
  })
})

describe('plural', () => {
  it('agrees with the count', () => {
    expect(plural(1, 'page')).toBe('1 page')
    expect(plural(0, 'page')).toBe('0 pages')
    expect(plural(2, 'page')).toBe('2 pages')
  })

  it('takes an irregular plural, and groups thousands', () => {
    expect(plural(2, 'search', 'searches')).toBe('2 searches')
    expect(plural(1200, 'page')).toBe('1,200 pages')
  })
})

describe('engineNames', () => {
  it('writes each engine the way its maker does', () => {
    expect(engineNames(['chatgpt', 'perplexity'])).toBe('ChatGPT, Perplexity')
  })

  it('shows an engine it does not know as it came', () => {
    expect(engineNames(['newthing'])).toBe('newthing')
  })
})
