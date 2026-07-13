import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRobotsTxt, type RobotsTxt } from '../src/robots/parse.js'

const here = dirname(fileURLToPath(import.meta.url))

export function loadRobots(name: string): RobotsTxt {
  return parseRobotsTxt(readFileSync(join(here, 'fixtures', `${name}.txt`), 'utf8'))
}
