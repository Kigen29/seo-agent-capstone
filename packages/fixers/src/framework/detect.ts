import type { Framework } from '@seo/core'

/**
 * Detect what a repository is built with, from the repository, not the rendered page.
 *
 * This is the advantage no dashboard competitor has: a crawler can guess a site is "probably
 * React" from the HTML, but only the repo tells you it is Next.js App Router with the metadata
 * API, which is what turns "add a canonical" into a diff in the right file. Detection reads a
 * few known files (dependencies and config), never the whole tree, so it is cheap and works
 * over the Contents API without a clone.
 *
 * The contract with the caller is deliberately tiny: a function that returns a file's contents
 * or null. That keeps the detector a pure function, testable against an in-memory map, and lets
 * the real caller back it with the GitHub provider's getFile.
 */

/** Read a repository file by path. Returns its contents, or null if it does not exist. */
export type ReadRepoFile = (path: string) => Promise<string | null>

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function readPackageJson(read: ReadRepoFile): Promise<PackageJson | null> {
  const raw = await read('package.json')
  if (!raw) return null
  try {
    return JSON.parse(raw) as PackageJson
  } catch {
    // A package.json that does not parse is not a signal we can use; fall through to file checks.
    return null
  }
}

/**
 * Detect the framework. The order matters: a meta-framework is checked before the library it is
 * built on (Next before React, Nuxt before Vue), because the more specific answer is the one
 * that produces a correct fix. An unrecognised repo returns `unknown`, which the fixers treat as
 * the universal static-HTML strategy. Unknown is a supported outcome, never a crash.
 */
export async function detectFramework(read: ReadRepoFile): Promise<Framework> {
  const pkg = await readPackageJson(read)
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const has = (name: string): boolean => name in deps

  const exists = async (path: string): Promise<boolean> => (await read(path)) !== null
  const existsAny = async (paths: string[]): Promise<boolean> => {
    for (const path of paths) if (await exists(path)) return true
    return false
  }
  const fileIncludes = async (path: string, needle: string): Promise<boolean> => {
    const content = await read(path)
    return content !== null && content.includes(needle)
  }

  // JavaScript meta-frameworks, most specific first.
  if (has('next') || (await existsAny(['next.config.js', 'next.config.mjs', 'next.config.ts'])))
    return 'next'
  if (has('nuxt') || has('nuxt3') || (await existsAny(['nuxt.config.js', 'nuxt.config.ts'])))
    return 'nuxt'
  if (has('@remix-run/react') || has('@remix-run/node') || has('@remix-run/serve')) return 'remix'
  if (has('gatsby') || (await existsAny(['gatsby-config.js', 'gatsby-config.ts']))) return 'gatsby'
  if (has('astro') || (await existsAny(['astro.config.mjs', 'astro.config.ts', 'astro.config.js'])))
    return 'astro'
  if (has('@sveltejs/kit') || (await exists('svelte.config.js'))) return 'sveltekit'

  // Single-page apps: the bare libraries, only after the meta-frameworks are ruled out.
  if (has('@angular/core') || (await exists('angular.json'))) return 'angular'
  if (has('vue')) return 'vue_spa'
  if (has('react') || has('react-dom')) return 'react_spa'

  // Non-JavaScript stacks, identified by their own signatures.
  if (await existsAny(['wp-config.php', 'wp-config-sample.php', 'wp-content/index.php']))
    return 'wordpress'
  if ((await exists('_config.yml')) && (await fileIncludes('Gemfile', 'jekyll'))) return 'jekyll'
  if (await existsAny(['hugo.toml', 'hugo.yaml', 'hugo.json'])) return 'hugo'
  if ((await exists('config.toml')) && (await fileIncludes('config.toml', 'baseURL'))) return 'hugo'
  if (await exists('manage.py')) return 'django'
  if ((await fileIncludes('Gemfile', 'rails')) || (await exists('bin/rails'))) return 'rails'

  return 'unknown'
}

/**
 * The families of head-injection strategy, one per way a framework exposes its document head.
 *
 * Grouping the fourteen frameworks into six strategies is what makes "support every stack"
 * tractable: a fixer implements one approach per family, not one per framework, and `universal`
 * is the honest fallback that edits a root HTML document directly when nothing more specific is
 * known.
 */
export type HeadStrategy =
  | 'framework-head' // a framework head/metadata API: Next, Nuxt, Astro, SvelteKit, Remix, Gatsby
  | 'spa-index' // the single index.html a SPA mounts into: React, Vue, Angular
  | 'template-hook' // a CMS template hook: WordPress wp_head
  | 'static-layout' // a static-site generator's layout template: Hugo, Jekyll
  | 'server-template' // a server framework's base template: Django, Rails
  | 'universal' // unknown: edit a root HTML document directly

const STRATEGY_BY_FRAMEWORK: Record<Framework, HeadStrategy> = {
  next: 'framework-head',
  nuxt: 'framework-head',
  astro: 'framework-head',
  sveltekit: 'framework-head',
  remix: 'framework-head',
  gatsby: 'framework-head',
  react_spa: 'spa-index',
  vue_spa: 'spa-index',
  angular: 'spa-index',
  wordpress: 'template-hook',
  hugo: 'static-layout',
  jekyll: 'static-layout',
  django: 'server-template',
  rails: 'server-template',
  unknown: 'universal',
}

/** The head-injection strategy family for a framework. Total: every framework maps to one. */
export function headStrategyFor(framework: Framework): HeadStrategy {
  return STRATEGY_BY_FRAMEWORK[framework]
}
