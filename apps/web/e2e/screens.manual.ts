import { expect, test, type Page } from '@playwright/test'

/**
 * A visual check: drives the real app and writes screenshots to `apps/web/screens/`.
 *
 * Named `.manual.ts` rather than `.spec.ts` on purpose, so Playwright's default `testMatch` does
 * not collect it and CI does not spend a minute writing PNGs nobody will look at. Run it by hand
 * when a change needs to be *seen* rather than asserted:
 *
 *     pnpm --filter @seo/web exec playwright test e2e/screens.manual.ts
 *
 * It is here because it earned its place. The faults it found had all passed the type checker, the
 * linter, and eleven end-to-end assertions: a mobile bar rendering on desktop and eating a third of
 * the sidebar's width, a theme toggle with a fourth empty cell, page-header actions orphaned on
 * their own line, and a call to action stretched into a full-width bar. None of those tools can
 * see. Looking is a different test.
 */
const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'
const AUDIT = '00000000-0000-4000-8000-000000000004'
const FINDING = '00000000-0000-4000-8000-000000000005'
const OUT = 'screens'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('API token').fill(TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('capture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/')
  await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: true })

  await signIn(page)
  // Wait for real content, or the capture races the skeleton and photographs the loading state.
  await expect(page.getByRole('heading', { name: 'Your sites' })).toBeVisible()
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true })

  await page.goto('/findings')
  await expect(page.locator('table tbody tr').first()).toBeVisible()
  await page.screenshot({ path: `${OUT}/03-findings.png`, fullPage: true })

  await page.goto(`/findings/${FINDING}`)
  await page.screenshot({ path: `${OUT}/04-finding.png`, fullPage: true })

  await page.goto(`/audits/${AUDIT}`)
  await page.screenshot({ path: `${OUT}/05-audit.png`, fullPage: true })

  await page.goto('/audits')
  await page.screenshot({ path: `${OUT}/06-audits.png`, fullPage: true })

  // The three research pages. Each has an unmeasured state that is the common case on a seeded
  // database, and that state is exactly what wants looking at: a dash with a reason should read
  // as an answer, not as a broken card.
  await page.goto('/keywords')
  await page.screenshot({ path: `${OUT}/10-keywords.png`, fullPage: true })

  await page.goto('/authority')
  await page.screenshot({ path: `${OUT}/11-authority.png`, fullPage: true })

  await page.goto('/visibility')
  await page.screenshot({ path: `${OUT}/12-visibility.png`, fullPage: true })

  // Mobile, and dark.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/findings')
  await page.screenshot({ path: `${OUT}/07-findings-mobile.png`, fullPage: true })
  // The dashboard is a two-column grid from md and one column below it, and the sidebar is now
  // three groups rather than three links, so the mobile disclosure is taller than it was.
  await page.goto('/dashboard')
  await page.screenshot({ path: `${OUT}/13-dashboard-mobile.png`, fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/findings')
  await page.screenshot({ path: `${OUT}/08-findings-dark.png`, fullPage: true })
  await page.goto('/dashboard')
  await page.screenshot({ path: `${OUT}/09-dashboard-dark.png`, fullPage: true })
})
