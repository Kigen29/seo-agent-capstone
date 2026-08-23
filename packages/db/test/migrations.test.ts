import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The migration folder and its journal must agree.
 *
 * Drizzle applies what the journal lists, not what the folder contains, so a `.sql` file with no
 * journal entry is a migration that will never run and will look, in every code review and every
 * green CI badge, exactly like one that will. That is not hypothetical here: `drizzle-kit
 * generate` diffs against a snapshot in `meta/` that stopped being updated at 0006, so it emits a
 * cumulative migration that tries to re-create tables which already exist. Every migration since
 * has been hand-written and hand-registered, and hand-registering is precisely the step a person
 * forgets.
 *
 * **This does not catch the failure that took production down**, and it is worth saying so rather
 * than letting a green test imply otherwise. That one was a correct, registered migration that had
 * simply never been run against Neon: CI applies migrations to a scratch container it creates for
 * itself, so it proved the code worked against a schema it had just built and said nothing about
 * production. The fix for that is `preDeployCommand` in render.yaml, not a test. This guards the
 * neighbouring mistake.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../migrations')

interface Journal {
  entries: { idx: number; tag: string }[]
}

const journal = JSON.parse(
  readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
) as Journal

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => name.replace(/\.sql$/, ''))
  .sort()

describe('the migration journal', () => {
  it('lists every migration file', () => {
    const registered = new Set(journal.entries.map((entry) => entry.tag))
    const orphans = files.filter((file) => !registered.has(file))

    expect(
      orphans,
      `${orphans.join(', ')} exist as .sql files and are not in meta/_journal.json, so Drizzle ` +
        'will never apply them. Add an entry, or delete the file.',
    ).toEqual([])
  })

  it('points at a file for every entry it lists', () => {
    const present = new Set(files)
    const missing = journal.entries.filter((entry) => !present.has(entry.tag))

    // The other direction: a journal entry with no file makes the runner throw on a database that
    // has not seen it yet, which is every fresh checkout and every CI run.
    expect(
      missing.map((entry) => entry.tag),
      'listed in the journal with no matching .sql file',
    ).toEqual([])
  })

  it('numbers entries contiguously from zero, in order', () => {
    // Drizzle applies in `idx` order. A gap or a duplicate means a migration runs out of sequence
    // or twice, and both are the kind of thing that only shows up on a fresh database, long after
    // the person who caused it has moved on.
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_entry, index) => index),
    )
  })

  it('has a filename whose numeric prefix matches its index', () => {
    for (const entry of journal.entries) {
      const prefix = Number(entry.tag.slice(0, 4))
      expect(prefix, `${entry.tag} is registered at idx ${entry.idx}`).toBe(entry.idx)
    }
  })
})
