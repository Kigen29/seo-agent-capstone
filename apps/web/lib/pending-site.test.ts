import { describe, expect, it, vi } from 'vitest'

// The cookie helpers need a request; the address check does not, and it is what is tested here.
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const { tidySiteAddress } = await import('./pending-site')

describe('tidySiteAddress', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  example.com  ', 'example.com'],
    ['https://www.example.co.ke/safaris', 'https://www.example.co.ke/safaris'],
    ['http://localhost.test:3000', 'http://localhost.test:3000'],
  ])('keeps %s', (raw, expected) => {
    expect(tidySiteAddress(raw)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['not a site'],
    ['example'],
    ['javascript:alert(1)'],
    ['//evil.example'],
    ['example.com/<script>alert(1)</script> x'],
    [`${'a'.repeat(300)}.com`],
  ])('refuses %s', (raw) => {
    expect(tidySiteAddress(raw)).toBeNull()
  })
})
