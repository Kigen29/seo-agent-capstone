import type { Finding, Framework } from '@seo/core'
import { describe, expect, it } from 'vitest'
import type { ReadRepoFile } from '../src/framework/detect.js'
import { SpaRewriteFixer } from '../src/fixers/spa-rewrite.js'
import { makeFinding } from './fixtures.js'

function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A TECH-022 finding, as the rule records it. */
function spaFinding(host: 'vercel' | 'netlify' = 'vercel'): Finding {
  return makeFinding({
    ruleId: 'TECH-022',
    title: '2 internal link(s) rendered by https://ex.com/ 404 at the host',
    affectedUrls: ['https://ex.com/', 'https://ex.com/about', 'https://ex.com/contact'],
    evidence: {
      kind: 'markup',
      url: 'https://ex.com/',
      locator: 'a[href]',
      snippet: JSON.stringify({
        host,
        shellUrl: 'https://ex.com/',
        affectedCount: 2,
        examples: [],
      }),
      observedAt: '2026-09-26T00:00:00.000Z',
      source: 'crawler',
    },
  })
}

const fixer = new SpaRewriteFixer()
const generate = (
  files: Record<string, string>,
  framework: Framework = 'react_spa',
  finding = spaFinding(),
) => fixer.generate({ finding, framework, read: reader(files) })

describe('SpaRewriteFixer', () => {
  it('claims TECH-022 findings that name a host it can fix', () => {
    expect(fixer.canFix(spaFinding('vercel'))).toBe(true)
    expect(fixer.canFix(spaFinding('netlify'))).toBe(true)
    expect(fixer.canFix(makeFinding({ ruleId: 'TECH-010' }))).toBe(false)
  })

  it('creates vercel.json with a catch-all rewrite when there is none', async () => {
    const result = await generate({})
    expect(result?.files).toEqual([
      {
        path: 'vercel.json',
        content: `${JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] }, null, 2)}\n`,
      },
    ])
    expect(result?.expectedEffect).toContain('200')
    expect(result?.rollback).toContain('vercel.json is removed')
  })

  it('keeps every existing setting and rewrite, and appends the catch-all last', async () => {
    const existing = {
      cleanUrls: true,
      rewrites: [{ source: '/api/(.*)', destination: 'https://api.ex.com/$1' }],
    }
    const result = await generate({ 'vercel.json': JSON.stringify(existing) })
    const written = JSON.parse(result!.files[0]!.content)
    expect(written).toEqual({
      cleanUrls: true,
      rewrites: [...existing.rewrites, { source: '/(.*)', destination: '/index.html' }],
    })
  })

  it.each([
    [
      'already has a catch-all',
      JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] }),
    ],
    ['uses legacy routes, which Vercel will not mix with rewrites', JSON.stringify({ routes: [] })],
    ['does not parse (a human owns it)', '{ // comment\n "rewrites": [] }'],
  ])('leaves vercel.json alone when it %s', async (_label, content) => {
    expect(await generate({ 'vercel.json': content })).toBeNull()
  })

  it.each(['next', 'nuxt', 'astro', 'gatsby', 'unknown'] as Framework[])(
    'refuses %s, which routes on the server or is not a known SPA',
    async (framework) => {
      expect(await generate({}, framework)).toBeNull()
    },
  )

  it('adds the Netlify catch-all to public/_redirects, keeping existing lines', async () => {
    const result = await generate(
      { 'public/_redirects': '/old  /new  301' },
      'vue_spa',
      spaFinding('netlify'),
    )
    expect(result?.files).toEqual([
      { path: 'public/_redirects', content: '/old  /new  301\n/*    /index.html   200\n' },
    ])
  })

  it('does nothing on Netlify when a catch-all already exists', async () => {
    expect(
      await generate(
        { 'public/_redirects': '/*  /index.html  200\n' },
        'react_spa',
        spaFinding('netlify'),
      ),
    ).toBeNull()
    expect(
      await generate(
        { 'netlify.toml': '[[redirects]]\nfrom = "/*"\nto = "/index.html"\nstatus = 200\n' },
        'react_spa',
        spaFinding('netlify'),
      ),
    ).toBeNull()
  })
})
