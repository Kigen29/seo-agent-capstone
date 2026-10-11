import { describe, expect, it } from 'vitest'
import { repoAccessNotes } from './repo-access'

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
