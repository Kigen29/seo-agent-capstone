import { describe, expect, it } from 'vitest'
import { filterRepos, repoAccessNotes } from './repo-access'

const MANAGE = 'https://github.com/settings/installations/7'
const repos = [
  { fullName: 'octo/site' },
  { fullName: 'octo/shop' },
  { fullName: 'Octo/blog' },
  { fullName: 'acme/other' },
]

describe('repoAccessNotes', () => {
  it('says the list is partial, how many it shows, and where to change that', () => {
    const [note] = repoAccessNotes(
      [{ login: 'octo', allRepositories: false, manageUrl: MANAGE }],
      repos,
    )

    expect(note).toEqual({
      login: 'octo',
      complete: false,
      text:
        'These are the 3 repositories on octo that RankWright has been allowed to see. ' +
        'The others are not listed until GitHub is told to share them.',
      manageUrl: MANAGE,
    })
  })

  it('offers nowhere to go when the list is already the whole account', () => {
    const [note] = repoAccessNotes(
      [{ login: 'octo', allRepositories: true, manageUrl: MANAGE }],
      repos,
    )

    expect(note?.complete).toBe(true)
    expect(note?.text).toBe('This is every repository on octo.')
    expect(note?.manageUrl).toBeUndefined()
  })

  it('counts each account by its own repositories', () => {
    const notes = repoAccessNotes(
      [
        { login: 'octo', allRepositories: false, manageUrl: MANAGE },
        { login: 'acme', allRepositories: false, manageUrl: `${MANAGE}8` },
      ],
      repos,
    )

    expect(notes[0]?.text).toContain('3 repositories on octo')
    expect(notes[1]?.text).toContain('This is the 1 repository on acme')
  })

  it('says so plainly when an account has granted nothing', () => {
    const [note] = repoAccessNotes(
      [{ login: 'empty', allRepositories: false, manageUrl: MANAGE }],
      repos,
    )

    expect(note?.text).toBe('RankWright has not been allowed to see any repository on empty yet.')
    expect(note?.manageUrl).toBe(MANAGE)
  })

  it('says nothing when the API did not describe the accounts', () => {
    expect(repoAccessNotes(undefined, repos)).toEqual([])
    expect(repoAccessNotes([], repos)).toEqual([])
  })
})

describe('filterRepos', () => {
  const list = [
    { fullName: 'Kigen29/kenya-safari-architect' },
    { fullName: 'Kigen29/code-5-website' },
    { fullName: 'acme/Safari-Blog' },
  ]
  const names = (query: string) => filterRepos(list, query).map((repo) => repo.fullName)

  it('returns everything, in order, for an empty or blank search', () => {
    expect(names('')).toEqual(list.map((repo) => repo.fullName))
    expect(names('   ')).toEqual(list.map((repo) => repo.fullName))
  })

  it('matches any part of the name, whatever the case', () => {
    expect(names('SAFARI')).toEqual(['Kigen29/kenya-safari-architect', 'acme/Safari-Blog'])
    expect(names('code-5')).toEqual(['Kigen29/code-5-website'])
  })

  it('needs every word, in any order', () => {
    expect(names('architect safari')).toEqual(['Kigen29/kenya-safari-architect'])
    expect(names('safari website')).toEqual([])
  })

  it('searches the owner as well as the repository', () => {
    expect(names('acme')).toEqual(['acme/Safari-Blog'])
    expect(names('kigen29 safari')).toEqual(['Kigen29/kenya-safari-architect'])
  })
})
