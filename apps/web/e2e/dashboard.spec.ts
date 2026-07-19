import { expect, test, type Page } from '@playwright/test'

/**
 * STORY-012's acceptance criteria, made executable.
 *
 *   "Given a finding, when I open it, then I see the evidence, the affected URLs, the
 *    expected impact, the effort, and the falsification condition in plain language."
 *
 * Those are claims about a screen, so nothing but a browser can check them. Everything below
 * this line goes through the real web app, the real API, and the real Postgres, with row-level
 * security switched on. Nothing is mocked, because the things most worth proving here (that a
 * blank axis stays blank, that another tenant sees a 404) are exactly the things a mock would
 * cheerfully lie about.
 *
 * Fixtures come from `@seo/audit`'s seed, whose scorecard is built by the real buildScorecard.
 * So if the product ever starts inventing scores for axes it never measured, the fixture
 * changes with it and these tests go red.
 */

const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'
const OTHER_TOKEN = 'seo_e2e_other_tenant_token_do_not_use'
const AUDIT = '00000000-0000-4000-8000-000000000004'
const BLOCKED_FINDING = '00000000-0000-4000-8000-000000000005'

async function signIn(page: Page, token = TOKEN) {
  await page.goto('/login')
  await page.getByLabel('API token').fill(token)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('signs in, and refuses a token that is not real', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('API token').fill('seo_not_a_real_token')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Scoped to the paragraph, not `getByRole('alert')`: Next renders its own route announcer
  // with role="alert", so the bare role matches two elements and the locator is ambiguous.
  await expect(page.locator('p[role="alert"]')).toContainText('not valid')
  await expect(page).toHaveURL(/\/login/)
})

test('turns an anonymous visitor away from the dashboard', async ({ page }) => {
  await page.goto('/dashboard')

  await expect(page).toHaveURL(/\/login/)
})

test('shows the eight axes, and leaves the four we did not measure blank', async ({ page }) => {
  // The single most important assertion in the suite. Four axes have no checks behind them,
  // and they must render as a dash: not 0, which reads as failure, and not 100, which reads
  // as a clean bill of health for something nobody looked at. A wall of eight green circles
  // is the artefact this entire product exists to replace, and it would be trivially easy to
  // ship one by accident right here.
  await signIn(page)
  await page.goto(`/dashboard/audits/${AUDIT}`)

  const measured = ['Crawl health', 'Content', 'Structure', 'AI visibility', 'Agent readiness']
  const blank = ['Performance', 'Authority', 'Local']

  for (const axis of [...measured, ...blank]) {
    await expect(page.getByText(axis, { exact: true })).toBeVisible()
  }

  // `exact`, because the coverage notes themselves open with "Not measured. Core Web Vitals
  // come from CrUX...", and a substring match happily counts those too. The status label and
  // the explanation are different claims and the test should not conflate them.
  await expect(page.getByText('Not measured', { exact: true })).toHaveCount(blank.length)
  await expect(page.getByText('--', { exact: true })).toHaveCount(blank.length)

  // And it says WHY each one is blank, naming the data source that would fill it. An axis
  // that says "not measured" and stops there is useless.
  await expect(page.getByText(/Core Web Vitals come from CrUX/)).toBeVisible()
})

test('never shows a single overall score', async ({ page }) => {
  // CLAUDE.md: "Never ship a single SEO score out of 100." The axes move independently, and a
  // site can have immaculate crawl health while being invisible to every AI engine on the web.
  await signIn(page)
  await page.goto(`/dashboard/audits/${AUDIT}`)

  await expect(page.getByText(/overall score/i)).toHaveCount(0)
  await expect(page.getByText(/total score/i)).toHaveCount(0)
  await expect(page.getByText('Eight scores, never one.')).toBeVisible()
})

test('leads the backlog with the critical finding, not the cheap one', async ({ page }) => {
  await signIn(page)
  await page.goto(`/dashboard/audits/${AUDIT}`)

  const first = page.locator('table tbody tr').filter({ hasText: 'TECH-' }).first()

  await expect(first).toContainText('Critical')
  await expect(first).toContainText('OAI-SearchBot')
})

test('opens a finding and shows how we would know we were wrong', async ({ page }) => {
  // The acceptance criterion, word for word. The falsification condition is what separates a
  // finding from an opinion, and if it is not on the screen the user has been handed an
  // opinion.
  await signIn(page)
  await page.goto(`/dashboard/findings/${BLOCKED_FINDING}`)

  await expect(page.getByText('How you would know we were wrong')).toBeVisible()
  await expect(page.getByText(/Re-fetch robots.txt and evaluate OAI-SearchBot/)).toBeVisible()

  // The evidence: what a parser actually saw, not what a model guessed.
  await expect(page.getByText('What we actually observed')).toBeVisible()
  await expect(page.getByText('User-agent: OAI-SearchBot')).toBeVisible()

  // The affected URLs, the effort, and the impact.
  await expect(page.getByText('Affected pages (1)')).toBeVisible()
  await expect(page.getByText('Trivial')).toBeVisible()
  await expect(page.getByText('95/100')).toBeVisible()
})

test('gives another tenant a 404, not a permission error', async ({ page }) => {
  // The end-to-end proof of ADR-0008 and ADR-0009, all the way from Postgres to the browser.
  // A "you do not have permission" page would confirm the audit is real, and let someone
  // enumerate which audits exist across the platform. The UI must be as ignorant as the API.
  await signIn(page, OTHER_TOKEN)

  await expect(page.getByText('No sites yet')).toBeVisible()

  const response = await page.goto(`/dashboard/audits/${AUDIT}`)

  expect(response?.status()).toBe(404)
  await expect(page.getByText(/permission|forbidden|not allowed/i)).toHaveCount(0)
})
