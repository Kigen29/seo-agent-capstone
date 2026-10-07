import { expect, test, type Page } from '@playwright/test'

/**
 * A visual check: drives the real app and writes screenshots to `apps/web/screens/`.
 *
 * Named `.manual.ts` rather than `.spec.ts` on purpose, so Playwright's default `testMatch` does
 * not collect it and CI does not spend a minute writing PNGs nobody will look at. Run it by hand
 * when a change needs to be *seen* rather than asserted:
 *
 *     pnpm --filter @seo/web exec playwright test --config playwright.screens.config.ts
 *
 * It is here because it earned its place. The faults it found had all passed the type checker, the
 * linter, and eleven end-to-end assertions: a mobile bar rendering on desktop and eating a third of
 * the sidebar's width, a theme toggle with a fourth empty cell, page-header actions orphaned on
 * their own line, and a call to action stretched into a full-width bar. None of those tools can
 * see. Looking is a different test.
 */
const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'
const SHOWCASE_TOKEN = 'seo_e2e_showcase_token_do_not_use_in_production'
const AUDIT = '00000000-0000-4000-8000-000000000004'
const FINDING = '00000000-0000-4000-8000-000000000005'
const OUT = 'screens'

/**
 * Go to a page and wait until it is actually the page, then photograph it.
 *
 * Without the wait, a capture races the route's `loading.tsx` and photographs the skeleton. That
 * is not a hypothetical: the finding detail, the audit and the audits list were all being captured
 * mid-load, so a reviewer would have studied three grey placeholder screens and concluded the
 * pages were fine. A harness that exists because looking is a different test has to actually look
 * at something.
 *
 * The h1 is the wait because every one of these routes has exactly one and no skeleton renders a
 * heading, so it needs no per-page selector.
 */
async function capture(page: Page, path: string, file: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true })
}

async function signIn(page: Page, token: string = TOKEN) {
  await page.context().addCookies([
    {
      name: 'seo_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await page.goto('/dashboard')
}

test('capture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await capture(page, '/', '01-landing.png')

  await signIn(page)
  // Wait for real content, or the capture races the skeleton and photographs the loading state.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true })

  await page.goto('/findings')
  await expect(page.locator('table tbody tr').first()).toBeVisible()
  await page.screenshot({ path: `${OUT}/03-findings.png`, fullPage: true })

  await capture(page, `/findings/${FINDING}`, '04-finding.png')

  await capture(page, `/audits/${AUDIT}`, '05-audit.png')

  await capture(page, '/audits', '06-audits.png')

  // The three research pages. Each has an unmeasured state that is the common case on a seeded
  // database, and that state is exactly what wants looking at: a dash with a reason should read
  // as an answer, not as a broken card.
  await capture(page, '/keywords', '10-keywords.png')

  await capture(page, '/authority', '11-authority.png')

  await capture(page, '/visibility', '12-visibility.png')

  // Mobile, and dark.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/findings')
  await expect(page.locator('article').first()).toBeVisible()
  await page.screenshot({ path: `${OUT}/07-findings-mobile.png`, fullPage: true })
  // The dashboard is a two-column grid from md and one column below it, and the sidebar is now
  // three groups rather than three links, so the mobile disclosure is taller than it was.
  await capture(page, '/dashboard', '13-dashboard-mobile.png')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await capture(page, '/findings', '08-findings-dark.png')
  await capture(page, '/dashboard', '09-dashboard-dark.png')

  // The two screens with the most distinct furniture and no capture until now: outcome cards with
  // a footer row, and the settings frame with its section nav, spend bar and sessions table.
  await capture(page, '/outcomes', '14-outcomes-dark.png')
  await capture(page, '/settings/account', '15-settings-account-dark.png')
  await capture(page, '/audits', '16-audits-dark.png')

  // The same screens with something on them. The tenant above is deliberately sparse, so every
  // capture so far is an empty or unmeasured state; this one has two audits, pull requests at
  // each stage, citations, authority figures and spend. See packages/audit/src/seed-showcase.ts.
  await signIn(page, SHOWCASE_TOKEN)
  await capture(page, '/dashboard', '20-showcase-dashboard.png')
  await capture(page, '/findings', '21-showcase-findings.png')
  await capture(page, '/audits', '22-showcase-audits.png')
  await capture(page, '/outcomes', '23-showcase-outcomes.png')
  await capture(page, '/visibility', '24-showcase-visibility.png')
  await capture(page, '/authority', '25-showcase-authority.png')
  await capture(page, '/competitors', '31-showcase-competitors.png')
  await capture(page, '/topics', '32-showcase-topics.png')
  await capture(page, '/settings/account', '26-showcase-settings.png')
  await capture(page, '/settings', '27-settings-appearance.png')
  await capture(page, '/settings/connections', '28-settings-connections.png')
  await capture(page, '/profile', '29-profile.png')
  await page.context().clearCookies()
  await capture(page, '/login', '30-login.png')
})

/**
 * Setup: the guided flow a new account lands in, and the page the same details live on after.
 *
 * Separate from the capture above so it can be run alone with `-g setup`.
 */
test('capture setup', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const site = '00000000-0000-4000-8000-000000000007'

  await signIn(page)
  await capture(page, '/onboarding', '40-onboarding-site.png')
  await capture(page, `/onboarding?siteId=${site}&step=business`, '41-onboarding-business.png')
  await capture(
    page,
    `/onboarding?siteId=${site}&step=competitors`,
    '42-onboarding-competitors.png',
  )
  await capture(page, `/onboarding?siteId=${site}&step=questions`, '43-onboarding-questions.png')
  await capture(page, `/onboarding?siteId=${site}&step=finish`, '44-onboarding-finish.png')
  await capture(page, `/site?siteId=${site}`, '45-site-setup.png')

  await page.getByLabel('About how competitors are used').click()
  await page.screenshot({ path: `${OUT}/46-site-setup-hint.png` })

  await capture(page, '/dashboard', '47-dashboard-setup-strip.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await capture(page, `/site?siteId=${site}`, '48-site-setup-mobile.png')
  await capture(page, `/onboarding?siteId=${site}&step=business`, '49-onboarding-mobile.png')
})

/** Authority: the lists as tabs, and the one composer. Run alone with `-g authority`. */
test('capture authority', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, SHOWCASE_TOKEN)
  await capture(page, '/authority', '50-authority.png')

  await page
    .getByRole('button', { name: /Write email to / })
    .first()
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: `${OUT}/51-authority-composer.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Write the draft' }).click()
  await page.screenshot({ path: `${OUT}/52-authority-composer-error.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('tab', { name: /Find publications/ }).click()
  await page.screenshot({ path: `${OUT}/53-authority-find.png`, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await capture(page, '/authority', '54-authority-mobile.png')
  await page
    .getByRole('button', { name: /Write email to / })
    .first()
    .click()
  await page.screenshot({ path: `${OUT}/55-authority-composer-mobile.png` })
})

/** The competitors page with its add panel open. Run alone with `-g competitors`. */
test('capture competitors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, SHOWCASE_TOKEN)
  await capture(page, '/competitors', '60-competitors.png')
  await page.getByRole('button', { name: 'Add competitor' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: `${OUT}/61-competitors-add.png` })
})
