import { expect, test, type Page } from '@playwright/test'

/**
 * The web app's security headers, checked where they take effect: in a browser.
 *
 * A content policy has two ways to be wrong and a unit test sees neither. Too loose, and it
 * protects nothing. Too tight, and the browser silently refuses one of the app's own scripts, a
 * page stops working, and the only trace is a line in a console nobody has open. So this asserts
 * both: that the headers are there, and that real pages load under them without the browser
 * reporting a single refusal.
 */

const TOKEN = 'seo_e2e_showcase_token_do_not_use_in_production'

async function signIn(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'seo_token', value: TOKEN, domain: '127.0.0.1', path: '/', httpOnly: true },
    ])
}

test('every page is served with the security headers', async ({ page }) => {
  for (const path of ['/', '/login', '/check']) {
    const response = await page.goto(path)
    const headers = response!.headers()

    expect(headers['content-security-policy'], path).toContain("default-src 'self'")
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(headers['content-security-policy'], path).toContain("object-src 'none'")
    expect(headers['x-frame-options'], path).toBe('DENY')
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy'], path).toContain('camera=()')
    // Which framework, and which version of it, is nobody's business.
    expect(headers['x-powered-by'], path).toBeUndefined()
  }
})

test('the content policy refuses nothing the app itself needs', async ({ page }) => {
  const refusals: string[] = []
  page.on('console', (message) => {
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(message.text())) {
      refusals.push(message.text())
    }
  })

  await signIn(page)
  // The pages with the most going on: client components, tabs, a dialog, an inline theme script.
  for (const path of [
    '/',
    '/login',
    '/dashboard',
    '/findings',
    '/authority',
    '/visibility',
    '/keywords',
    '/site',
    '/settings',
    '/onboarding',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  }

  // Interaction too, since hydration is where a blocked script would show.
  await page.goto('/authority')
  await page
    .getByRole('button', { name: /Write email to / })
    .first()
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()

  expect(refusals).toEqual([])
})

test('the app cannot be put in a frame on another page', async ({ page }) => {
  await page.setContent(
    `<iframe id="frame" src="http://127.0.0.1:3111/login" width="600" height="400"></iframe>`,
  )
  await page.waitForLoadState('networkidle')
  const frame = page.frameLocator('#frame')

  // A browser that honours the header shows its own error page, not the sign-in screen.
  await expect(frame.getByRole('heading', { name: 'Sign in' })).toHaveCount(0)
})
