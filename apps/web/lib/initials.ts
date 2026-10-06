/**
 * First letters of the name, or of the email, or a dash. Never an empty circle.
 *
 * A plain module on purpose. This used to be exported from `components/ui/avatar.tsx`, which is a
 * client file, and a function exported from a client file cannot be called while a page renders
 * on the server: Next replaces it with a reference that throws. The profile page did exactly
 * that, so it crashed for every person who was actually signed in, and for nobody in the tests,
 * which sign in with a token that has no identity and so never reached the call.
 */
export function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim()
  if (!source) return '\u2014'

  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}
