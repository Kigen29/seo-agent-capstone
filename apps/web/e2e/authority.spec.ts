import { expect, test, type Page } from '@playwright/test'

/**
 * The authority page's outreach flow, against the tenant with history.
 *
 * The page used to carry a folded form under every row of three stacked lists. What is asserted
 * here is the shape that replaced it: one list at a time, one action per row, one composer, and
 * a fact that does not have to be typed twice. No model is configured in this environment, so
 * the draft itself is covered by the API's own tests; what a browser can prove is that declining
 * to write is said plainly and nothing is ever offered that sends.
 */

// The tenant with history: packages/audit/src/seed-showcase.ts.
const SHOWCASE_TOKEN = 'seo_e2e_showcase_token_do_not_use_in_production'

async function signIn(page: Page) {
  await page.context().addCookies([
    {
      name: 'seo_token',
      value: SHOWCASE_TOKEN,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test('the three outreach lists are tabs, and the page has no form until one is asked for', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/authority')

  await expect(page.getByRole('heading', { name: 'Who to contact' })).toBeVisible()
  const tabs = page.getByRole('tablist')
  await expect(tabs.getByRole('tab', { name: /Wrote about you \(\d+\)/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /Link to competitors \(\d+\)/ })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /Find publications/ })).toBeVisible()

  // Every row offers the same single action, and no email form is on the page until it is used.
  await expect(page.getByRole('button', { name: /Write email to / }).first()).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Draft an email')).toHaveCount(0)
})

test('the composer opens for one publication, asks for the fact, and offers nothing that sends', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/authority')

  await page
    .getByRole('button', { name: /Write email to / })
    .first()
    .click()

  const composer = page.getByRole('dialog')
  await expect(composer.getByRole('heading', { name: /^Email to / })).toBeVisible()
  await expect(composer.getByText('Step 1 of 2: your fact')).toBeVisible()

  // Asking for a draft with no fact is refused in the shared error shape, before any request.
  await composer.getByRole('button', { name: 'Write the draft' }).click()
  await expect(composer.locator('.note[role="alert"]')).toContainText('Two things are needed first')

  await expect(composer.getByRole('button', { name: /^send/i })).toHaveCount(0)

  await composer.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the fact is kept for the next publication', async ({ page }) => {
  await signIn(page)
  await page.goto('/authority')

  const write = page.getByRole('button', { name: /Write email to / })
  await write.first().click()

  const composer = page.getByRole('dialog')
  await composer
    .getByRole('textbox', { name: 'The one fact only you have' })
    .fill('We have published vehicle occupancy for every Mara circuit since 2011.')
  await composer
    .getByRole('textbox', { name: 'Where an editor can check it' })
    .fill('https://example.com/fleet')
  await composer.getByRole('button', { name: 'Write the draft' }).click()

  // With no model in this environment the honest outcomes are a declined draft or a described
  // failure. Either way something is said, in a note, and the form is still there to change.
  await expect(composer.locator('.note').first()).toBeVisible()
  await composer.getByRole('button', { name: 'Cancel' }).click()

  await write.nth(1).click()
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'The one fact only you have' }),
  ).toHaveValue('We have published vehicle occupancy for every Mara circuit since 2011.')
})

test('finding publications starts from the topic and is one clear action', async ({ page }) => {
  await signIn(page)
  await page.goto('/authority')

  await page.getByRole('tab', { name: /Find publications/ }).click()
  const find = page.getByRole('button', { name: 'Find publications' })
  // Nothing to search for yet, so the button waits.
  await expect(find).toBeDisabled()
  await page
    .getByRole('textbox', { name: 'Your topic, in two or three words' })
    .fill('safari tours')
  await expect(find).toBeEnabled()
})

test('every mention is a link to the page that carried it', async ({ page }) => {
  await signIn(page)
  await page.goto('/authority')

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Where you were mentioned' }),
  })
  await expect(section).toBeVisible()

  // A site, how many of its pages name the brand, and whether it links back.
  const site = section.getByRole('row').filter({ hasText: 'field-notes.example.org' }).first()
  await expect(site.getByRole('link')).toHaveCount(2)
  await expect(site).toContainText('No link yet')

  // The link goes to the mention itself, in a new tab, telling that site nothing about this one.
  const mention = section.getByRole('link', { name: /Guided day trips, compared/ })
  await expect(mention).toHaveAttribute(
    'href',
    'https://field-notes.example.org/2026/09/guided-day-trips-compared',
  )
  await expect(mention).toHaveAttribute('target', '_blank')
  await expect(mention).toHaveAttribute('rel', /noopener/)
  await expect(mention).toHaveAttribute('rel', /noreferrer/)

  // A result with no title still gets a link, named by its path.
  await expect(section.getByRole('link', { name: /three-days-on-foot/ })).toBeVisible()

  // Platforms are listed apart, and are not shown as coverage.
  await expect(section.getByText('1 platform you can post to yourself')).toBeVisible()
})

test('a publication to contact opens on what it wrote, not on its front page', async ({ page }) => {
  await signIn(page)
  await page.goto('/authority')

  const row = page
    .getByRole('tabpanel')
    .getByRole('row')
    .filter({ hasText: 'travel-desk.example.net' })
  await expect(row.getByRole('link', { name: 'travel-desk.example.net' })).toHaveAttribute(
    'href',
    'https://travel-desk.example.net/guides/off-season-departures',
  )
})

test('the page shows how the mentions were found, and how many results were refused', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/authority')

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Where you were mentioned' }),
  })
  // The name that was searched, the rule a result has to pass, and what did not pass it.
  await expect(section).toContainText('Searched for the exact name')
  await expect(section).toContainText('contains that name as written')
  await expect(section).toContainText('2 results were left out')
  // Checked results carry no warning about being unchecked.
  await expect(section.getByText('These results were not checked for your exact name')).toHaveCount(
    0,
  )
})

test('a site can be marked as not us, leaves the page at once, and can be put back', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/authority')

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Where you were mentioned' }),
  })
  // A run that failed half way leaves the site marked, and the seed does not reset it. Start
  // from a known place, so one bad run cannot fail every run after it.
  const leftover = section.locator('details').filter({ hasText: 'you marked as not you' })
  if ((await leftover.count()) > 0) {
    await leftover.locator('summary').click()
    await leftover
      .getByRole('button', { name: /Put back/ })
      .first()
      .click()
    await expect(section.getByText('you marked as not you')).toHaveCount(0)
  }

  const site = section.getByRole('row').filter({ hasText: 'regional-news.example.net' })
  await expect(site.first()).toBeVisible()
  await page.waitForLoadState('networkidle')

  await site
    .first()
    .getByRole('button', { name: /Not us/ })
    .click()

  // Gone from the list without a reload, and recorded where it can be undone.
  await expect(section.getByRole('link', { name: /Tourism season opens/ })).toHaveCount(0)
  const marked = section.locator('details').filter({ hasText: 'you marked as not you' })
  await expect(marked).toContainText('1 site you marked as not you')

  // Still gone after a reload: it was stored, not just hidden.
  await page.reload()
  await expect(section.getByRole('link', { name: /Tourism season opens/ })).toHaveCount(0)

  await marked.locator('summary').click()
  await marked.getByRole('button', { name: /Put back/ }).click()
  await expect(section.getByRole('link', { name: /Tourism season opens/ })).toBeVisible()
  await expect(section.getByText('you marked as not you')).toHaveCount(0)
})

/**
 * A competitor added from the panel on the competitors page appears on that page.
 *
 * On the account with history, on purpose, and three times over. This shipped with a test on a
 * nearly empty account, which passed, while on a populated one the page stayed stale 8 times out
 * of 9: the route has a loading file, and after a server action the router does not reliably
 * show a page that arrives in two parts. A fault that shows most of the time and not always
 * needs more than one attempt to be believed either way.
 */
test('a competitor added from the panel shows on a populated competitors page, every time', async ({
  page,
}) => {
  await signIn(page)

  for (const round of [1, 2, 3]) {
    const domain = `added-in-round-${round}.example.com`
    await page.goto('/competitors')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Add competitor' }).click()
    const panel = page.getByRole('dialog')
    await panel.getByLabel('Add one yourself').fill(domain)
    await panel.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(panel.getByRole('row').filter({ hasText: domain })).toBeVisible()
    await panel.getByRole('button', { name: 'Done' }).click()

    // On the page itself, with the panel gone, and without anybody reloading by hand.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('main').getByText(domain).first()).toBeVisible({ timeout: 10_000 })

    // Take it off again, so the next round and the next run start from the same list.
    await page.getByRole('button', { name: 'Add competitor' }).click()
    await page
      .getByRole('dialog')
      .getByRole('row')
      .filter({ hasText: domain })
      .getByRole('button', { name: /Remove/ })
      .click()
    await expect(page.getByRole('dialog').getByRole('row').filter({ hasText: domain })).toHaveCount(
      0,
    )
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('main').getByText(domain)).toHaveCount(0, { timeout: 10_000 })
  }
})
