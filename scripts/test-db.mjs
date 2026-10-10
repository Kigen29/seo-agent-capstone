#!/usr/bin/env node
/**
 * Bring the local test database up and give it the current schema. One command:
 *
 *     pnpm test:db
 *
 * It exists because of a morning lost to it. The test Postgres keeps its data in memory on
 * purpose (compose.test.yml), so it is disposable and fast. The other side of that is that every
 * time Docker stops, the database comes back empty: no schema, no roles. The browser suite then
 * fails with a connection error or a missing relation, neither of which says "start Docker and
 * migrate", and the steps to recover lived in nobody's head.
 *
 * What it does, in order, stopping at the first thing that is wrong and saying what to do:
 *
 *   1. checks the Docker engine is answering, which is the usual cause;
 *   2. starts the container and waits for Postgres to accept connections;
 *   3. applies every migration.
 *
 * The address is fixed here and never read from `.env`. That file points at the real database,
 * and a helper that could migrate production because a variable happened to be set is not a
 * helper. `pnpm db:migrate` is the command that reads `.env`; this one cannot.
 */
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The disposable database from compose.test.yml. Loopback only, trust auth, nothing to leak. */
const TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:15432/rankwright_test'

/**
 * No shell. This repository lives under a path with a space in it on at least one machine, and
 * a command line passed through a shell there is split in the wrong place. Each program is
 * named and given its arguments as a list.
 */
const run = (command, args, options = {}) =>
  spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })

/**
 * pnpm, however it was installed. Run as `pnpm test:db`, pnpm tells its scripts where it lives,
 * and that is used, because on a machine where pnpm is not on the PATH there is nothing else to
 * find it by. Run directly with node, it falls back to the name and a shell.
 */
const pnpm = (args) =>
  process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args])
    : run('pnpm', args, { shell: true })

function fail(message) {
  console.error(`\ntest-db: ${message}\n`)
  process.exit(1)
}

const engine = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
})
if (engine.status !== 0 || !engine.stdout.trim()) {
  fail(
    'Docker is not running. Start Docker Desktop, wait for it to say the engine is running, ' +
      'and run this again.',
  )
}

console.log('test-db: starting the test database')
// `--wait` returns once the container's own health check passes, so there is no sleep to tune.
if (run('docker', ['compose', '-f', 'compose.test.yml', 'up', '-d', '--wait']).status !== 0) {
  fail('The container did not start. `docker compose -f compose.test.yml logs` says why.')
}

console.log('test-db: building the database package')
if (pnpm(['--filter', '@seo/db', 'build']).status !== 0) {
  fail('The database package did not build, so there is no migration runner to use.')
}

console.log('test-db: applying migrations')
const migrated = run(process.execPath, ['dist/migrate.js'], {
  cwd: join(root, 'packages', 'db'),
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, TEST_DATABASE: '1' },
})
if (migrated.status !== 0) fail('The migrations did not apply. The error above is the reason.')

console.log(
  '\ntest-db: ready. Build once (pnpm build), then run the browser tests with:\n\n' +
    `  DATABASE_URL=${TEST_DATABASE_URL} TEST_DATABASE=1 ALLOW_E2E_SEED=1 pnpm test:e2e\n`,
)
