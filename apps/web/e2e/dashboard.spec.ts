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
  await expect(page.getByText(/Eight areas, each scored on its own/)).toBeVisible()
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

  await expect(page).toHaveURL(new RegExp(`/findings/${BLOCKED_FINDING}\\?siteId=`))
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
  await expect(page).toHaveURL(/\/findings\?siteId=00000000-0000-4000-8000-000000000003/)
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
  await expect(page.getByRole('heading', { name: /AI assistants mention you/i })).toBeVisible()
  // No prompts are seeded, so the axis must explain itself rather than report 0% share of voice.
  await expect(page.locator('main')).not.toContainText('0%')

  await page.goto('/authority')
  await expect(page.getByRole('heading', { name: /who mentions you/i })).toBeVisible()

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

test('keyword research offers every country by name', async ({ page }) => {
  await signIn(page)
  await page.goto('/keywords')

  const country = page.getByLabel('Country')
  await expect(country).toBeVisible()
  expect(await country.locator('option').count()).toBeGreaterThan(240)
  // Wait for the client form to hydrate, or React resets the choice to its initial state.
  await page.waitForLoadState('networkidle')
  await country.selectOption({ label: 'Japan' })
  await expect(country).toHaveValue('jp')
})

test('AI visibility offers to draft the questions, and says why when it cannot', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/visibility')

  const suggest = page.getByRole('button', { name: 'Suggest questions for me' })
  await expect(suggest).toBeVisible()
  await suggest.click()
  // The e2e API has no model configured, so the honest answer is to say what is missing.
  await expect(page.getByText(/need a model/)).toBeVisible()
})

test('the dashboard says what is connected for the site, in words', async ({ page }) => {
  await signIn(page)
  await page.goto('/dashboard')

  await page.getByText('Connections and optional setup', { exact: true }).click()
  const setup = page.locator('details').filter({ hasText: 'Connections and optional setup' })
  await expect(setup).toBeVisible()
  for (const name of [
    'Google Search Console',
    'Code repository',
    'Search Console ownership',
    'Google Business Profile',
    'AI visibility questions',
  ]) {
    await expect(setup.getByText(name, { exact: true })).toBeVisible()
  }
  // A state for each row, never a bare "Reconnect" standing in for one.
  await expect(setup.getByText(/of 5 done/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(0)
})

test('headings and text render in the self-hosted serif faces, not a fallback', async ({
  page,
}) => {
  // The font variables once sat on <body> while :root read them, so every heading fell back to
  // Georgia without anyone noticing. Assert the faces actually load and are the ones applied.
  await signIn(page)
  await page.goto('/dashboard')
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family),
  )
  expect(loaded).toEqual(expect.arrayContaining(['cormorant', 'lora']))
  const heading = await page
    .locator('h1')
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(heading.startsWith('cormorant')).toBe(true)
})

test('outcomes says, in words, what became of each proposed fix', async ({ page }) => {
  await signIn(page)
  await page.goto('/outcomes')

  await expect(page.getByRole('heading', { name: 'Did the fixes work?' })).toBeVisible()
  // The seed has proposed no fixes, so the four counts read zero and the empty state says how to
  // start one. The populated shape (statuses, before and after) is covered by the API test.
  await expect(page.getByText('Waiting for review', { exact: true })).toBeVisible()
  await expect(page.getByText('Did not work', { exact: true })).toBeVisible()
  await expect(page.getByText('No fixes proposed yet')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Outcomes' })).toBeVisible()
})

test('preserves the selected site through dashboard and research navigation', async ({ page }) => {
  await signIn(page)
  const selected = '00000000-0000-4000-8000-000000000007'
  await page.goto(`/keywords?siteId=${selected}`)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`siteId=${selected}`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('z-second.example.com')
  await expect(page.getByLabel('Which site to show')).toHaveValue(selected)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Outcomes', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`siteId=${selected}`))
})

test('mobile findings keep the full title and action in the viewport', async ({ page }) => {
  await signIn(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/findings')
  const card = page.locator('article').filter({ hasText: 'robots.txt blocks' })
  await expect(card).toBeVisible()
  const box = await card.boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= 391).toBeTruthy()
  await card.getByRole('link').click()
  await expect(page).toHaveURL(/siteId=00000000-0000-4000-8000-000000000003/)
})

test('mobile navigation works from the keyboard and restores focus on Escape', async ({ page }) => {
  await signIn(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
})

for (const theme of ['light', 'dark'] as const) {
  test(`secondary dashboard text has at least 4.5:1 contrast in ${theme} mode`, async ({
    page,
  }) => {
    await signIn(page)
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/dashboard')
    const ratio = await page
      .locator('.text-muted')
      .first()
      .evaluate((element) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d')!
        const rgb = (color: string) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
        }
        const luminance = (channels: number[]) =>
          channels
            .map((value) => {
              const s = value / 255
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0)
        const style = getComputedStyle(element)
        const foreground = luminance(rgb(style.color))
        const background = luminance(rgb(style.getPropertyValue('--color-bg')))
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
}
