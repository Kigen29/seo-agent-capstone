/** A redirect target must remain a path within the application origin. */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return undefined
  if (
    [...next].some(
      (character) =>
        character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined
  try {
    const origin = 'https://redirect.invalid'
    const target = new URL(next, origin)
    return target.origin === origin ? next : undefined
  } catch {
    return undefined
  }
}
