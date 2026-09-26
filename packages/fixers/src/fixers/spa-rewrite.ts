import type { Finding, Framework } from '@seo/core'
import type { FixContext, Fixer, FixResult } from '../engine.js'

/**
 * TECH-022: a single-page app has no catch-all rewrite, so every inner URL is the host's own 404.
 *
 * The app routes in the browser, so clicking around works and nobody notices. A crawler, or a
 * person opening a shared link, asks the host for `/about` directly, the host has no such file,
 * and it answers 404 before the app ever loads. The fix is one rule in the hosting config: serve
 * `index.html` for every path and let the client-side router take it from there.
 *
 * Deliberately narrow. It only acts for the frameworks that ship as a static SPA (React, Vue,
 * Angular without a meta-framework), because Next, Nuxt, Remix, SvelteKit, Astro and Gatsby route
 * on the server or prerender their pages, and a catch-all there would shadow real routes. It only
 * edits config it can parse and extend without changing what is already there, and it refuses a
 * `vercel.json` that uses the legacy `routes` key, which Vercel will not combine with `rewrites`.
 */

const SPA_FRAMEWORKS: ReadonlySet<Framework> = new Set(['react_spa', 'vue_spa', 'angular'])

type Host = 'vercel' | 'netlify'

const CATCH_ALL = { source: '/(.*)', destination: '/index.html' }
const NETLIFY_LINE = '/*    /index.html   200'

/** The host TECH-022 attributed the 404s to, from its JSON evidence snippet. */
function hostOf(finding: Finding): Host | null {
  if (finding.evidence.kind !== 'markup') return null
  try {
    const parsed = JSON.parse(finding.evidence.snippet) as { host?: unknown }
    return parsed.host === 'vercel' || parsed.host === 'netlify' ? parsed.host : null
  } catch {
    return null
  }
}

export class SpaRewriteFixer implements Fixer {
  readonly ruleId = 'TECH-022'

  canFix(finding: Finding): boolean {
    return finding.ruleId === 'TECH-022' && hostOf(finding) !== null
  }

  async generate(ctx: FixContext): Promise<FixResult | null> {
    if (!SPA_FRAMEWORKS.has(ctx.framework)) return null
    const host = hostOf(ctx.finding)
    if (host === 'vercel') return this.vercel(ctx)
    // Angular copies public assets only as configured in angular.json, so a _redirects file in
    // public/ is not guaranteed to be deployed. Refuse rather than open a PR that does nothing.
    if (host === 'netlify' && ctx.framework !== 'angular') return this.netlify(ctx)
    return null
  }

  private async vercel(ctx: FixContext): Promise<FixResult | null> {
    const existing = await ctx.read('vercel.json')

    let config: Record<string, unknown> = {}
    if (existing !== null) {
      try {
        const parsed: unknown = JSON.parse(existing)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        config = parsed as Record<string, unknown>
      } catch {
        // Comments or broken JSON: a human owns this file, and rewriting it could lose intent.
        return null
      }
      // Vercel rejects `routes` alongside `rewrites`; mixing them would break the deploy.
      if ('routes' in config) return null
    }

    const rewrites = Array.isArray(config['rewrites']) ? [...config['rewrites']] : []
    const alreadyCatchAll = rewrites.some(
      (rule) =>
        rule !== null &&
        typeof rule === 'object' &&
        (rule as { destination?: unknown }).destination === '/index.html' &&
        ['/(.*)', '/:path*', '/(.*)/'].includes(String((rule as { source?: unknown }).source)),
    )
    if (alreadyCatchAll) return null

    // Appended last: Vercel serves real files first and applies rewrites in order, so existing
    // rewrites (an API proxy, say) keep matching before the catch-all.
    const next = { ...config, rewrites: [...rewrites, CATCH_ALL] }

    return {
      files: [{ path: 'vercel.json', content: `${JSON.stringify(next, null, 2)}\n` }],
      expectedEffect: this.effect('vercel.json'),
      rollback:
        existing === null
          ? 'Revert the merge commit; vercel.json is removed and inner URLs return to the 404 they served before.'
          : 'Revert the merge commit; the catch-all rewrite is removed and every other setting in vercel.json is unchanged.',
    }
  }

  private async netlify(ctx: FixContext): Promise<FixResult | null> {
    const path = 'public/_redirects'
    const existing = await ctx.read(path)
    if (existing !== null && /^\s*\/\*\s+\/index\.html\s+200\b/m.test(existing)) return null

    const toml = await ctx.read('netlify.toml')
    if (toml !== null && /to\s*=\s*["']\/index\.html["']/.test(toml)) return null

    const content =
      existing === null
        ? `${NETLIFY_LINE}\n`
        : `${existing}${existing.endsWith('\n') ? '' : '\n'}${NETLIFY_LINE}\n`

    return {
      files: [{ path, content }],
      expectedEffect: this.effect('public/_redirects'),
      rollback:
        'Revert the merge commit; the catch-all redirect is removed and inner URLs return to the 404 they served before.',
    }
  }

  private effect(file: string): string {
    return (
      `${file} now serves index.html for every path, so a direct request to an inner page ` +
      '(what Googlebot and anyone opening a shared link sends) returns 200 with the app instead ' +
      "of the host's 404, and the pages become indexable. Expect Search Console to move them from " +
      '"Not found (404)" to crawled over the next crawls; indexing itself can take weeks. One ' +
      'caveat to check after merging: a URL the app does not recognise now also returns 200, so ' +
      'the app should render a not-found view with noindex for unknown routes.'
    )
  }
}
