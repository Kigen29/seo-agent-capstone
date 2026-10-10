import { expect, test, type Page } from '@playwright/test'

/**
 * The schedule page (ADR-0044).
 *
 * The claim under test is that the page shows what the worker will do and nothing else: a site
 * with competitors and questions has readings and checks on its calendar without anybody
 * scheduling them, an audit appears only once scheduled audits are turned on, and turning them
 * off takes it away again.
 */

const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'
const SHOWCASE_TOKEN = 'seo_e2e_showcase_token_do_not_use_in_production'
const SHOWCASE_SITE = '00000000-0000-4000-8000-000000000103'

// One site's setting is changed and changed back, so these must not interleave.
test.describe.configure({ mode: 'default' })

async function signIn(page: Page, token: string) {
  await page
    .context()
    .addCookies([{ name: 'seo_token', value: token, domain: '127.0.0.1', path: '/' }])
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

function shift(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7)
}

const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  )

test('the schedule is reachable from the sidebar and names the month', async ({ page }) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.goto('/dashboard')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Schedule', exact: true })
    .click()

  await expect(page).toHaveURL(/\/schedule/)
  await expect(page.getByRole('heading', { level: 1, name: 'What runs, and when' })).toBeVisible()
  await expect(page.getByRole('heading', { name: monthName(thisMonth()) })).toBeVisible()
})

test('what already runs on a timer is on the calendar without being scheduled by hand', async ({
  page,
}) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.goto(`/schedule?siteId=${SHOWCASE_SITE}`)

  // The grid is a table with a heading for each weekday, and today is marked as today.
  const grid = page.getByRole('table', { name: /What runs for showcase\.example\.com/ })
  await expect(grid).toBeVisible()
  await expect(grid.getByRole('columnheader')).toHaveCount(7)
  await expect(grid.locator('td[aria-current="date"]')).toHaveCount(1)

  // The showcase site tracks questions and competitors, so both are coming up.
  const coming = page.getByRole('table', { name: 'What is coming up' })
  await expect(coming.getByText('AI answers check').first()).toBeVisible()
  await expect(coming.getByText(/^Read rival-/).first()).toBeVisible()

  // And what has run is listed apart from what is to come.
  await expect(page.getByRole('table', { name: 'What has already run' })).toBeVisible()
})

test('an audit is on the calendar only while scheduled audits are on', async ({ page }) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.goto(`/schedule?siteId=${SHOWCASE_SITE}`)

  const coming = page.getByRole('table', { name: 'What is coming up' })
  const weekly = page.getByRole('radio', { name: 'Every 7 days' })
  const off = page.getByRole('radio', { name: 'Only when I ask' })

  await expect(off).toBeChecked()
  await expect(coming.getByText('Scheduled audit')).toHaveCount(0)

  // The radio itself is visually hidden inside its label, which is the thing a person presses.
  await page.getByText('Every 7 days', { exact: true }).click()
  await expect(page.getByText('This site is now audited every 7 days.')).toBeVisible()
  await expect(coming.getByText('Scheduled audit').first()).toBeVisible()

  // Stored, not just drawn.
  await page.reload()
  await expect(weekly).toBeChecked()

  await page.getByText('Only when I ask', { exact: true }).click()
  await expect(page.getByText('Scheduled audits are off.')).toBeVisible()
  await expect(coming.getByText('Scheduled audit')).toHaveCount(0)
})

test('the months either side are a link away, and a link back', async ({ page }) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.goto(`/schedule?siteId=${SHOWCASE_SITE}`)

  const next = shift(thisMonth(), 1)
  await page
    .getByRole('navigation', { name: 'Months' })
    .getByRole('link', { name: new RegExp(monthName(next)) })
    .click()
  await expect(page).toHaveURL(new RegExp(`month=${next}`))
  await expect(page.getByRole('heading', { name: monthName(next) })).toBeVisible()
  // The site was kept.
  await expect(page).toHaveURL(new RegExp(`siteId=${SHOWCASE_SITE}`))

  await page.getByRole('link', { name: 'This month' }).click()
  await expect(page.getByRole('heading', { name: monthName(thisMonth()) })).toBeVisible()
})

test('a month too far away shows this month and says why', async ({ page }) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.goto(`/schedule?siteId=${SHOWCASE_SITE}&month=${shift(thisMonth(), 30)}`)
  await expect(page.getByText(/twelve months either side/)).toBeVisible()
  await expect(page.getByRole('heading', { name: monthName(thisMonth()) })).toBeVisible()
})

test('a site with nothing set up says what would put something here', async ({ page }) => {
  await signIn(page, TOKEN)
  await page.goto('/schedule?siteId=00000000-0000-4000-8000-000000000007')
  await expect(page.getByText('Nothing ran or is due in these weeks')).toBeVisible()
  // The control is still offered: it is the first thing that would fill the calendar.
  await expect(page.getByText('Every 7 days', { exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Only when I ask' })).toBeChecked()
})

test('the calendar file is a calendar, and is not served without a session', async ({ page }) => {
  const anonymous = await page.request.get(`/schedule/calendar.ics?siteId=${SHOWCASE_SITE}`)
  expect(anonymous.status()).toBe(401)

  await signIn(page, SHOWCASE_TOKEN)
  const response = await page.request.get(`/schedule/calendar.ics?siteId=${SHOWCASE_SITE}`)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/calendar')
  expect(response.headers()['content-disposition']).toContain('showcase.example.com')
  const body = await response.text()
  expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true)
  expect(body).toContain('BEGIN:VEVENT')
  expect(body).toContain('DTSTART;VALUE=DATE:')

  // Another account's site is not a calendar this session can download.
  await signIn(page, TOKEN)
  const other = await page.request.get(`/schedule/calendar.ics?siteId=${SHOWCASE_SITE}`)
  expect(other.status()).toBe(404)
})

test('on a phone the lists stand in for the grid', async ({ page }) => {
  await signIn(page, SHOWCASE_TOKEN)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/schedule?siteId=${SHOWCASE_SITE}`)

  await expect(page.getByRole('table', { name: /What runs for/ })).toBeHidden()
  await expect(page.getByRole('table', { name: 'What is coming up' })).toBeVisible()
  // Nothing scrolls sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
