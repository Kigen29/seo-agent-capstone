import type { InstalledRepo } from '@seo/vcs'

// A stale duplicate of chooseRepoForSite's doc comment sat above matchRepoForSite here, saying it
// would "fall back to the first" repo. It does the opposite: it returns null rather than guess,
// which is the whole reason the two functions are separate. Removed rather than moved, because
// chooseRepoForSite already carries the correct version below.

/**
 * The repo in an installation that belongs to a site, or null when none clearly does.
 *
 * Matches on the site's domain stem against the repo name, comparing both with punctuation
 * removed, so `lakevictoriaaquaculture.com` matches a repo named `lake-victoria-aquaculture`.
 * Exact first, then either name being a substring of the other. Returns null rather than guess:
 * the reuse-an-installation path must not bind the wrong repo to a site, so a non-match is sent to
 * GitHub to grant the right repo instead.
 */
export function matchRepoForSite(repos: InstalledRepo[], siteUrl: string): InstalledRepo | null {
  let stem = ''
  try {
    stem = normaliseName(new URL(siteUrl).hostname.replace(/^www\./, '').split('.')[0] ?? '')
  } catch {
    return null
  }
  if (!stem) return null

  const exact = repos.find((repo) => normaliseName(repo.name) === stem)
  if (exact) return exact

  // A substring match only for names distinctive enough to trust it. A one or two character stem
  // ("a.com", "app.io" -> "app") would otherwise match almost any repo, so short names get an
  // exact match only.
  const MIN_PARTIAL = 4
  if (stem.length < MIN_PARTIAL) return null

  return (
    repos.find((repo) => {
      const name = normaliseName(repo.name)
      return name.includes(stem) || (name.length >= MIN_PARTIAL && stem.includes(name))
    }) ?? null
  )
}

const normaliseName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Pick which of a fresh install's granted repositories to connect to a site.
 *
 * Used by the install callback, where the user has explicitly granted a set of repos, so a
 * fall-back to the first is reasonable when no name matches. The stricter {@link matchRepoForSite}
 * is used on the reuse path, where guessing would silently bind the wrong repo.
 */
export function chooseRepoForSite(repos: InstalledRepo[], siteUrl: string): InstalledRepo {
  if (repos.length === 1) return repos[0]!
  return matchRepoForSite(repos, siteUrl) ?? repos[0]!
}
