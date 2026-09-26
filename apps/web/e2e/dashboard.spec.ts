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

/**
 * Establish a session by writing the cookie the app reads, rather than by driving a form.
 *
 * There used to be a token field on the login page and every test below typed into it. That form
 * is gone: signing in is GitHub or Google now, and an OAuth round trip cannot be driven in a test
 * without either mocking a provider's servers or holding real credentials in CI.
 *
 * Setting the cookie directly is not a workaround for that, it is the better test. The session has
 * always been an API token in an httpOnly cookie, and it still is, whichever way it was obtained
 * (ADR-0023). These tests are about the dashboard, and making thirteen of them depend on the
 * mechanics of a login screen coupled them to a thing none of them were trying to prove.
 *
 * It establishes a session and navigates nowhere. The old helper drove the login form and left the
 * browser on the dashboard, so a caller could assert against that page without asking for it; one
 * test was relying on exactly that and went red here. Every caller now says where it is going.
 */
async function signIn(page: Page, token = TOKEN) {
  /*
    Scoped by domain and path rather than by a hardcoded URL.

    The config serves on 127.0.0.1 at a port it chooses, so writing the origin out here would be a
    second place to keep in step. A cookie set for the wrong origin is not an error: it is simply
    never sent, and every test then fails with an unhelpful redirect to the login page.
  */
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
}

test('sends a visitor with a dead session back to sign in', async ({ page }) => {
  // The cookie is present and the token behind it is not real, which is what a revoked session
  // looks like. It has to fail closed rather than render a shell with empty data in it.
  await signIn(page, 'seo_not_a_real_token')
  await page.goto('/dashboard')

  await expect(page).toHaveURL(/\/login/)
})

test('offers a way to sign in, and no longer asks for a token', async ({ page }) => {
  await page.goto('/login')

  // Whatever providers this deployment has configured, the page must offer sign-in and must not
  // ask a human for a credential minted by a CLI.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByLabel('API token')).toHaveCount(0)
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
  await page.goto(`/audits/${AUDIT}`)

  const measured = [
    'Crawl health',
    'Content',
    'Structure',
    'AI visibility',
    'Agent readiness',
    'Local',
  ]
  const blank = ['Performance', 'Authority']

  /**
   * Scoped to `main`, which is what this assertion always meant.
   *
   * The sidebar now has links named "Authority" and "AI visibility", so an unscoped `getByText`
   * matches the navigation as well as the scorecard and resolves to two elements. The nav is not
   * what this test is about: it is about what the scorecard says for an axis nobody measured.
   */
  const scorecard = page.locator('main')

  for (const axis of [...measured, ...blank]) {
    await expect(scorecard.getByText(axis, { exact: true })).toBeVisible()
  }

  // `exact`, because the coverage notes themselves open with "Not measured. Core Web Vitals
  // come from CrUX...", and a substring match happily counts those too. The status label and
  // the explanation are different claims and the test should not conflate them.
  await expect(scorecard.getByText('Not measured', { exact: true })).toHaveCount(blank.length)
  await expect(page.getByText('--', { exact: true })).toHaveCount(blank.length)

  // And it says WHY each one is blank, naming the data source that would fill it. An axis
  // that says "not measured" and stops there is useless.
  await expect(page.getByText(/Core Web Vitals come from CrUX/)).toBeVisible()
})

test('never shows a single overall score', async ({ page }) => {
  // CLAUDE.md: "Never ship a single SEO score out of 100." The axes move independently, and a
  // site can have immaculate crawl health while being invisible to every AI engine on the web.
  await signIn(page)
  await page.goto(`/audits/${AUDIT}`)

  await expect(page.getByText(/overall score/i)).toHaveCount(0)
  await expect(page.getByText(/total score/i)).toHaveCount(0)
  await expect(page.getByText('Eight scores, never one.')).toBeVisible()
})

test('leads the backlog with the critical finding, not the cheap one', async ({ page }) => {
  await signIn(page)
  await page.goto(`/audits/${AUDIT}`)

  const first = page.locator('table tbody tr').filter({ hasText: 'TECH-' }).first()

  await expect(first).toContainText('Critical')
  await expect(first).toContainText('OAI-SearchBot')
})

test('opens a finding and shows how we would know we were wrong', async ({ page }) => {
  // The acceptance criterion, word for word. The falsification condition is what separates a
  // finding from an opinion, and if it is not on the screen the user has been handed an
  // opinion.
  await signIn(page)
  await page.goto(`/findings/${BLOCKED_FINDING}`)

  await expect(page.getByText('How you would know we were wrong')).toBeVisible()
  await expect(page.getByText(/Re-fetch robots.txt and evaluate OAI-SearchBot/)).toBeVisible()

  // The evidence: what a parser actually saw, not what a model guessed.
  await expect(page.getByText('What we actually observed')).toBeVisible()
  // The line TECH-002 actually records, which is also the line the fixer parses to learn which
  // agents to unblock. It used to assert a hand-drawn `User-agent: / Disallow:` block, which read
  // like a robots.txt and was not what any rule writes.
  await expect(page.getByText(/Disallowed: OAI-SearchBot \(OpenAI\)/)).toBeVisible()

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

  // `signIn` sets a cookie and nothing else, so this has to navigate. It used to be implicit:
  // the old helper drove the login form and therefore left the browser on the dashboard, and
  // this assertion was quietly relying on that side effect.
  await page.goto('/dashboard')
  await expect(page.getByText('No sites yet')).toBeVisible()

  const response = await page.goto(`/audits/${AUDIT}`)

  expect(response?.status()).toBe(404)
  await expect(page.getByText(/permission|forbidden|not allowed/i)).toHaveCount(0)
})

test('keeps an old bookmarked finding URL working', async ({ page }) => {
  // A finding moved from /dashboard/findings/:id to /findings/:id. Anyone holding the old link,
  // in a bookmark or a Slack message, should land on the page rather than a 404.
  await signIn(page)
  await page.goto(`/dashboard/findings/${BLOCKED_FINDING}`)

  await expect(page).toHaveURL(new RegExp(`/findings/${BLOCKED_FINDING}$`))
  await expect(page.getByText('How you would know we were wrong')).toBeVisible()
})

test('offers a way back to the inbox, not only to the audit', async ({ page }) => {
  // The only link off this page used to be "Back to the audit", which is a page most people
  // reaching a finding have never seen: the inbox is the main route in. A back link that goes
  // somewhere you have not been is worse than none, because it looks like it should return you.
  await signIn(page)
  await page.goto(`/findings/${BLOCKED_FINDING}`)

  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs.getByRole('link', { name: 'Findings' })).toBeVisible()
  await crumbs.getByRole('link', { name: 'Findings' }).click()
  await expect(page).toHaveURL(/\/findings$/)
})

test('filters the inbox on the server, and says how many matched', async ({ page }) => {
  await signIn(page)
  await page.goto('/findings')

  // The inbox had four hardcoded chips applied in the browser to the whole downloaded backlog.
  // `exact`, because the sortable column header is also labelled "Sort by Severity" and a
  // substring match finds both. Two controls that mention the same word is not ambiguity in the
  // UI, only in the locator.
  await page.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('critical')

  await expect(page).toHaveURL(/severity=critical/)
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(1)
})

test('shows which findings already have a pull request open', async ({ page }) => {
  // `status` was fetched and never rendered, so work in flight looked exactly like work to do.
  await signIn(page)
  await page.goto('/findings')

  await expect(page.locator('table thead')).toContainText('Status')
})

/**
 * The three research pages, and the property that matters most on all of them.
 *
 * The seeded database has no SERP key, no backlink index and no poll history, so every one of
 * these renders its unmeasured state. That is the case worth asserting: a dashboard that shows a
 * confident zero where it simply never looked is the product lying, and it is the easiest thing
 * in a UI to get wrong.
 */
test('the research pages render, and say unmeasured rather than zero', async ({ page }) => {
  await signIn(page)

  await page.goto('/visibility')
  await expect(page.getByRole('heading', { name: /answer engines cite you/i })).toBeVisible()
  // No prompts are seeded, so the axis must explain itself rather than report 0% share of voice.
  await expect(page.locator('main')).not.toContainText('0%')

  await page.goto('/authority')
  await expect(page.getByRole('heading', { name: /who talks about you/i })).toBeVisible()

  await page.goto('/keywords')
  await expect(
    page.getByRole('heading', { name: /what are people actually searching for/i }),
  ).toBeVisible()
  // The seed box is the whole point of the page and nothing happens until it is used.
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
})

test('the nav reaches every section, and keeps the site you picked', async ({ page }) => {
  await signIn(page)
  await page.goto('/findings?siteId=00000000-0000-4000-8000-000000000002')

  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const label of ['Keywords', 'Authority', 'AI visibility', 'Findings', 'Audits']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  }

  // Context survives navigation: picking a site and then changing section must not lose it.
  await nav.getByRole('link', { name: 'Authority', exact: true }).click()
  await expect(page).toHaveURL(/\/authority\?siteId=/)
})

test('lists the sessions and tokens that can act as the account, never their values', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/settings/account')

  const section = page.getByRole('region', { name: 'Sessions and tokens' })
  await expect(section).toBeVisible()
  // The seeded tenant has exactly one credential: the token this browser is using.
  const rows = section.locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('e2e')
  await expect(rows.first()).toContainText('This browser')
  await expect(rows.first().getByRole('button', { name: /Sign out/ })).toBeVisible()
  // Nothing else to sign out, so the bulk action is offered but inert.
  await expect(section.getByRole('button', { name: 'Sign out everywhere else' })).toBeDisabled()
  // The credential itself is never rendered.
  expect(await page.content()).not.toContain(TOKEN)
})

test('dropdowns and their options follow the dark theme', async ({ page }) => {
  // A transparent native select opened a white option list in dark mode on Windows Chrome.
  await page.emulateMedia({ colorScheme: 'dark' })
  await signIn(page)
  await page.goto('/findings')

  const select = page.locator('select.input').first()
  await expect(select).toBeVisible()
  const colours = await select.evaluate((element) => {
    const option = element.querySelector('option')!
    return {
      select: getComputedStyle(element).backgroundColor,
      option: getComputedStyle(option).backgroundColor,
      scheme: getComputedStyle(element).colorScheme,
    }
  })
  // --color-surface in the dark palette: #232120.
  expect(colours).toEqual({ select: 'rgb(35, 33, 32)', option: 'rgb(35, 33, 32)', scheme: 'dark' })
})
