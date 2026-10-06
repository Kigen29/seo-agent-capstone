import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { initials } from './initials'

const here = dirname(fileURLToPath(import.meta.url))

describe('initials', () => {
  it('takes the first letters of a name', () => {
    expect(initials('Emmanuel Kigen', 'e@example.com')).toBe('EK')
  })

  it('falls back to the email, then to a dash, never to nothing', () => {
    expect(initials(null, 'emmanuel.kigen@example.com')).toBe('ek')
    expect(initials(null, null)).toBe('\u2014')
    expect(initials('  ', '')).toBe('\u2014')
  })
})

/**
 * The profile page renders on the server and calls `initials`. If the function is ever moved back
 * into a client file the page throws for every signed-in person, and no browser test notices,
 * because the test session has no identity. So the property is asserted on the source.
 */
describe('initials stays callable from a server component', () => {
  it('is not defined in a client file', () => {
    expect(readFileSync(join(here, 'initials.ts'), 'utf8')).not.toMatch(/^['"]use client['"]/m)
  })

  it('is not exported from the avatar client component', () => {
    const avatar = readFileSync(join(here, '../components/ui/avatar.tsx'), 'utf8')

    expect(avatar).toMatch(/^['"]use client['"]/m)
    expect(avatar).not.toMatch(/export function initials/)
  })

  it('is imported by the profile page from the plain module', () => {
    const page = readFileSync(join(here, '../app/(app)/profile/page.tsx'), 'utf8')

    expect(page).toMatch(/import \{ initials \} from '@\/lib\/initials'/)
  })
})
