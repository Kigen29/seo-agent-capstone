import { frameworkSchema, type Framework } from '@seo/core'
import { describe, expect, it } from 'vitest'
import { detectFramework, headStrategyFor, type ReadRepoFile } from '../src/framework/detect.js'

/** A repo reader backed by an in-memory map of path -> contents. */
function reader(files: Record<string, string>): ReadRepoFile {
  return async (path) => (path in files ? files[path]! : null)
}

/** A package.json with the given dependencies. */
const pkg = (deps: Record<string, string>): string => JSON.stringify({ dependencies: deps })

const detect = (files: Record<string, string>) => detectFramework(reader(files))

describe('detectFramework', () => {
  it('detects JS meta-frameworks by dependency', async () => {
    expect(await detect({ 'package.json': pkg({ next: '15.0.0' }) })).toBe('next')
    expect(await detect({ 'package.json': pkg({ nuxt: '3.0.0' }) })).toBe('nuxt')
    expect(await detect({ 'package.json': pkg({ '@remix-run/react': '2.0.0' }) })).toBe('remix')
    expect(await detect({ 'package.json': pkg({ gatsby: '5.0.0' }) })).toBe('gatsby')
    expect(await detect({ 'package.json': pkg({ astro: '4.0.0' }) })).toBe('astro')
    expect(await detect({ 'package.json': pkg({ '@sveltejs/kit': '2.0.0' }) })).toBe('sveltekit')
  })

  it('detects a framework from its config file even without package.json', async () => {
    expect(await detect({ 'next.config.mjs': 'export default {}' })).toBe('next')
    expect(await detect({ 'astro.config.ts': 'export default {}' })).toBe('astro')
    expect(await detect({ 'angular.json': '{}' })).toBe('angular')
  })

  it('detects SPAs, but only after the meta-frameworks are ruled out', async () => {
    expect(await detect({ 'package.json': pkg({ '@angular/core': '18.0.0' }) })).toBe('angular')
    expect(await detect({ 'package.json': pkg({ vue: '3.4.0' }) })).toBe('vue_spa')
    expect(await detect({ 'package.json': pkg({ react: '19.0.0', 'react-dom': '19.0.0' }) })).toBe(
      'react_spa',
    )
  })

  it('prefers the meta-framework over the library it is built on', async () => {
    // A Next app always has React as a dependency. The correct answer is next, not react_spa,
    // because the fix goes in Next's metadata, not a bare index.html.
    expect(await detect({ 'package.json': pkg({ next: '15.0.0', react: '19.0.0' }) })).toBe('next')
    expect(await detect({ 'package.json': pkg({ nuxt: '3.0.0', vue: '3.4.0' }) })).toBe('nuxt')
  })

  it('detects non-JavaScript stacks by signature', async () => {
    expect(await detect({ 'wp-config.php': '<?php' })).toBe('wordpress')
    expect(await detect({ '_config.yml': 'title: x', Gemfile: "gem 'jekyll'" })).toBe('jekyll')
    expect(await detect({ 'hugo.toml': 'baseURL = "/"' })).toBe('hugo')
    expect(await detect({ 'config.toml': 'baseURL = "https://x"' })).toBe('hugo')
    expect(await detect({ 'manage.py': '# django' })).toBe('django')
    expect(await detect({ Gemfile: "gem 'rails', '7.1'" })).toBe('rails')
  })

  it('returns unknown for an unrecognised repo, and never throws', async () => {
    expect(await detect({})).toBe('unknown')
    expect(await detect({ 'README.md': '# hello' })).toBe('unknown')
  })

  it('tolerates a malformed package.json and falls back to file signals', async () => {
    expect(
      await detect({ 'package.json': '{ not json', 'next.config.js': 'module.exports={}' }),
    ).toBe('next')
    expect(await detect({ 'package.json': '{ not json' })).toBe('unknown')
  })
})

describe('headStrategyFor', () => {
  it('groups frameworks into the right strategy family', () => {
    expect(headStrategyFor('next')).toBe('framework-head')
    expect(headStrategyFor('react_spa')).toBe('spa-index')
    expect(headStrategyFor('wordpress')).toBe('template-hook')
    expect(headStrategyFor('hugo')).toBe('static-layout')
    expect(headStrategyFor('rails')).toBe('server-template')
    expect(headStrategyFor('unknown')).toBe('universal')
  })

  it('maps every framework in the enum to a strategy, so nothing is unhandled', () => {
    for (const framework of frameworkSchema.options as Framework[]) {
      expect(headStrategyFor(framework)).toBeTruthy()
    }
  })
})
