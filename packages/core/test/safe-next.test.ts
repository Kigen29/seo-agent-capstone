import { describe, expect, it } from 'vitest'
import { safeNext } from '../src/safe-next.js'

describe('safeNext', () => {
  it.each([
    '//outside.example',
    '/\\outside.example',
    '/\n/outside.example',
    '/\t/outside.example',
    'https://outside.example',
    'relative',
  ])('rejects %j', (target) => {
    expect(safeNext(target)).toBeUndefined()
  })
  it('preserves a local path and query', () => {
    expect(safeNext('/findings?severity=high#evidence')).toBe('/findings?severity=high#evidence')
  })
})
