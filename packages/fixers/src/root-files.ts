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
