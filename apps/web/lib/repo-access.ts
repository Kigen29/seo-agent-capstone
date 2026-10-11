import type { RepoAccount } from '@seo/api-client'
import { plural } from './format'

/**
 * What the repository picker says about its own list.
 *
 * A GitHub App sees only the repositories it was granted. Somebody who ticked three at install
 * sees three in the picker, and nothing on the page said the rest of their account existed or
 * how to bring it in: the list read as "these are your repositories", and to connect a new site
 * they had to know to go and find a settings page on GitHub.
 *
 * So each account gets a sentence that says which case it is in. When the grant is partial, the
 * sentence comes with the one place on GitHub where it is changed, and what to press there.
 * Nothing here can list the repositories that were not granted. No call the App can make
 * returns them, which is the point of the grant.
 */
export interface RepoAccessNote {
  login: string
  /** True when there is nothing more to bring in. */
  complete: boolean
  text: string
  /** Where to change the grant. Absent when the list is already the whole account. */
  manageUrl?: string
}

export function repoAccessNotes(
  accounts: readonly RepoAccount[] | undefined,
  repos: readonly { fullName: string }[],
): RepoAccessNote[] {
  return (accounts ?? []).map((account) => {
    const shown = repos.filter(
      (repo) => repo.fullName.split('/')[0]?.toLowerCase() === account.login.toLowerCase(),
    ).length

    if (account.allRepositories) {
      return {
        login: account.login,
        complete: true,
        text: `This is every repository on ${account.login}.`,
      }
    }

    return {
      login: account.login,
      complete: false,
      text:
        shown === 0
          ? `RankWright has not been allowed to see any repository on ${account.login} yet.`
          : `${shown === 1 ? 'This is the' : 'These are the'} ${plural(shown, 'repository', 'repositories')} ` +
            `on ${account.login} that RankWright has been allowed to see. ` +
            'The others are not listed until GitHub is told to share them.',
      manageUrl: account.manageUrl,
    }
  })
}

/** Above this many repositories the picker offers a search box. Below it, the eye is faster. */
export const SEARCH_REPOS_FROM = 6

/**
 * The repositories whose name contains every word typed, in any order and any case.
 *
 * Words, not one phrase, because a repository is remembered in pieces: "safari architect" should
 * find `kenya-safari-architect`. The owner is searched too, since two accounts can each hold a
 * repository of the same name. The order of the list is kept.
 */
export function filterRepos<T extends { fullName: string }>(
  repos: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...repos]

  return repos.filter((repo) => {
    const name = repo.fullName.toLowerCase()
    return words.every((word) => name.includes(word))
  })
}
