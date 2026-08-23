/**
 * Where a site's well-known root files live in a repository, most conventional first.
 *
 * robots.txt and llms.txt are neighbours at the site root, so they share the same candidate
 * locations, and a repo's existing robots.txt is the surest signal of where root files belong.
 * One shared list keeps the two fixers that read it from drifting apart.
 */
export const ROBOTS_FILES = [
  'public/robots.txt',
  'robots.txt',
  'static/robots.txt',
  'src/robots.txt',
] as const

/**
 * A committed sitemap, which is a file a fixer can both prove exists and edit.
 *
 * Every entry serves at `/sitemap.xml`, so a caller never has to work out a public URL from
 * whichever one matched.
 */
export const SITEMAP_FILES = [
  'public/sitemap.xml',
  'static/sitemap.xml',
  'sitemap.xml',
  'src/sitemap.xml',
] as const

/**
 * Framework sources that generate a sitemap at build time.
 *
 * These prove a sitemap will be served and cannot be edited as XML: a Next.js `app/sitemap.ts`
 * returns an array from code, and rewriting that safely is a different job from editing markup.
 * So they count as evidence that `/sitemap.xml` exists, and nothing more.
 */
export const GENERATED_SITEMAP_FILES = [
  'app/sitemap.ts',
  'app/sitemap.js',
  'src/app/sitemap.ts',
  'src/app/sitemap.js',
] as const
