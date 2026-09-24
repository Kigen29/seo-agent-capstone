import { describe, expect, it } from 'vitest'
import { assertTestDatabase } from '../src/test-database.js'
const flags = { TEST_DATABASE: '1', ALLOW_E2E_SEED: '1' }
describe('test database boundary', () => {
  it('accepts only explicitly marked local fixtures', () => {
    expect(() =>
      assertTestDatabase({
        ...flags,
        DATABASE_URL: 'postgresql://postgres@127.0.0.1:55432/rankwright_test',
      }),
    ).not.toThrow()
  })
  it.each([
    'postgresql://user@remote.example/seo_test',
    'postgresql://user@localhost/production',
    'https://localhost/seo_test',
  ])('refuses %s', (DATABASE_URL) => {
    expect(() => assertTestDatabase({ ...flags, DATABASE_URL })).toThrow('Refusing')
  })
  it('does not grant itself permission', () => {
    expect(() =>
      assertTestDatabase({ DATABASE_URL: 'postgresql://postgres@localhost/seo_test' }),
    ).toThrow('Refusing')
  })
})
