/** Public fixtures may only be written to an explicitly disposable local database. */
export function assertTestDatabase(env: Record<string, string | undefined>): void {
  if (env.ALLOW_E2E_SEED !== '1' || env.TEST_DATABASE !== '1') {
    throw new Error('Refusing fixtures: set TEST_DATABASE=1 and ALLOW_E2E_SEED=1 explicitly.')
  }
  let url: URL
  try {
    url = new URL(env.DATABASE_URL ?? '')
  } catch {
    throw new Error('Refusing fixtures: DATABASE_URL must identify a disposable local database.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/(seo_test|rankwright_test)$/.test(url.pathname)
  ) {
    throw new Error(
      'Refusing fixtures: only local seo_test or rankwright_test databases are allowed.',
    )
  }
}
