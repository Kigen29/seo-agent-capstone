import { expect, test, type Page } from '@playwright/test'

/**
 * Onboarding and the site setup page, through the real app, API and database.
 *
 * What is worth proving in a browser here is the joins between screens: that an account with no
 * site is taken to setup and not to an empty dashboard, that an address typed before sign-in is
 * waiting after it, and that a detail saved in onboarding is the same detail the site setup page
 * shows. The rules behind each form are covered by the API's own tests.
 *
 * Writes go to the seed's second site, so they cannot disturb the tests in the other file that
 * assert on the first site having no competitors.
 */

const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'
// A tenant the seed gives no sites, which is exactly what a new account looks like.
const EMPTY_TOKEN = 'seo_e2e_other_tenant_token_do_not_use'
const SECOND_SITE = '00000000-0000-4000-8000-000000000007'

/*
  One at a time, in order. Several tests here edit the second site's competitor list, and a save
  replaces the whole list, so two of them running at once overwrite each other and one fails for
  no reason of its own. The rest of the suite stays parallel; only this file gives that up.
*/
test.describe.configure({ mode: 'default' })

async function signIn(page: Page, token = TOKEN) {
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

test('an account with no site lands in setup, not on an empty dashboard', async ({ page }) => {
  await signIn(page, EMPTY_TOKEN)
  await page.goto('/dashboard')

  await expect(page).toHaveURL(/\/onboarding/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Which site should we look after?',
  )
  await expect(page.getByText('Step 1 of 5')).toBeVisible()
  // Nothing to go back to yet, so no way out is offered.
  await expect(page.getByRole('link', { name: 'Finish later' })).toHaveCount(0)
})

test('a site typed on the landing page is waiting after sign-in', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Your website address').fill('carried-through.example.com')
  await page.getByRole('button', { name: 'Audit my site' }).click()

  // Nobody is signed in, so setup sends them to sign in and remembers where they were going.
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)onboarding/)

  await signIn(page, EMPTY_TOKEN)
  await page.goto('/onboarding')
  await expect(page.getByLabel('Your website')).toHaveValue('carried-through.example.com')
})

test('onboarding refuses something that is not a web address, in the shared error shape', async ({
  page,
}) => {
  await signIn(page, EMPTY_TOKEN)
  await page.goto('/onboarding')

  await page.getByLabel('Your website').fill('not a site')
  await page.getByRole('button', { name: 'Continue' }).click()

  const alert = page.locator('.note[role="alert"]')
  await expect(alert).toContainText('That is not a web address')
  await expect(alert).toContainText('like example.com')
  await expect(page).toHaveURL(/\/onboarding$/)
})

test('details saved in onboarding are the details site setup shows', async ({ page }) => {
  await signIn(page)
  await page.goto(`/onboarding?siteId=${SECOND_SITE}&step=business`)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell us about the business')
  await page.getByRole('textbox', { name: 'Brand name' }).fill('Second Example Tours')
  await page.getByRole('textbox', { name: 'Where your customers are' }).fill('Kenya')
  await page.getByRole('textbox', { name: 'What you offer' }).fill('Walking tours for small groups')
  await page.getByRole('button', { name: 'Save and continue' }).click()

  await expect(page).toHaveURL(/step=competitors/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who do you compete with?')

  await page.goto(`/site?siteId=${SECOND_SITE}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Site setup')
  await expect(page.getByRole('textbox', { name: 'Brand name' })).toHaveValue(
    'Second Example Tours',
  )
  await expect(page.getByRole('textbox', { name: 'Where your customers are' })).toHaveValue('Kenya')
  await expect(page.getByRole('textbox', { name: 'What you offer' })).toHaveValue(
    'Walking tours for small groups',
  )
})

test('a competitor can be typed, is stored as a bare domain, and can be removed', async ({
  page,
}) => {
  await signIn(page)
  await page.goto(`/site?siteId=${SECOND_SITE}`)

  const field = page.getByLabel('Add one yourself')
  await field.fill('https://www.Typed-Rival.example.com/pricing')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  const row = page.getByRole('listitem').filter({ hasText: 'typed-rival.example.com' })
  await expect(row).toBeVisible()
  await expect(field).toHaveValue('')

  // Stored, not just drawn: it is still there after a reload.
  await page.reload()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: /Remove/ }).click()
  await expect(row).toHaveCount(0)
})

test('asking for suggestions with no model says so, and typing still works', async ({ page }) => {
  await signIn(page)
  await page.goto(`/site?siteId=${SECOND_SITE}`)

  await page.getByRole('button', { name: 'Suggest competitors' }).click()

  // The e2e API has no model configured. The honest answer names what is missing and what the
  // person can still do, in the same note every other failure uses.
  const alert = page.locator('.note[role="alert"]')
  await expect(alert).toContainText('This is not switched on')
  await expect(alert).toContainText('typing their web addresses')
  await expect(page.getByLabel('Add one yourself')).toBeEnabled()
})

test('the dashboard carries one line of setup and a single way to finish it', async ({ page }) => {
  await signIn(page)
  await page.goto('/dashboard')

  await expect(page.getByText(/Setup: \d of 7 done/)).toBeVisible()
  await expect(page.getByText(/^Next: /)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Finish setup' })).toHaveAttribute(
    'href',
    /\/site\?siteId=/,
  )
  // The checklist itself has moved, so the dashboard no longer offers to connect anything.
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toHaveCount(0)
})

test('the info hint opens with the keyboard and names what it explains', async ({ page }) => {
  await signIn(page)
  await page.goto(`/site?siteId=${SECOND_SITE}`)

  const hint = page.getByLabel('About how competitors are used')
  await hint.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByText(/Share of voice counts how often AI assistants cite you/),
  ).toBeVisible()
})

test('the last step offers the first audit as the one primary action', async ({ page }) => {
  await signIn(page)
  await page.goto(`/onboarding?siteId=${SECOND_SITE}&step=finish`)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ready for the first audit')
  await expect(page.getByRole('button', { name: 'Run the first audit' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open site setup' })).toHaveAttribute(
    'href',
    new RegExp(`/site\\?siteId=${SECOND_SITE}`),
  )
})

test('a competitor can be added from the top of the competitors page', async ({ page }) => {
  await signIn(page)
  await page.goto(`/competitors?siteId=${SECOND_SITE}`)

  await page.getByRole('button', { name: 'Add competitor' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel.getByRole('heading', { name: 'Your competitors' })).toBeVisible()

  await panel.getByLabel('Add one yourself').fill('from-the-top.example.com')
  await panel.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    panel.getByRole('listitem').filter({ hasText: 'from-the-top.example.com' }),
  ).toBeVisible()

  // Closing shows it on the page behind, without a reload by hand.
  await panel.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('main').getByText('from-the-top.example.com').first()).toBeVisible()

  // Tidy up, so a rerun starts from the same place.
  await page.getByRole('button', { name: 'Add competitor' }).click()
  await page
    .getByRole('dialog')
    .getByRole('listitem')
    .filter({ hasText: 'from-the-top.example.com' })
    .getByRole('button', { name: /Remove/ })
    .click()
  await expect(
    page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'from-the-top.example.com' }),
  ).toHaveCount(0)
})

test('a competitor can be given the name it goes by, and it is kept', async ({ page }) => {
  await signIn(page)
  await page.goto(`/site?siteId=${SECOND_SITE}`)

  await page.getByLabel('Add one yourself').fill('named-by-hand.example.com')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'named-by-hand.example.com' })
  // Just added, so nothing has read its homepage yet, and the page says exactly that.
  await expect(row).toContainText('Name not read yet')

  await row.getByRole('button', { name: /Add its name/ }).click()
  await row.getByLabel('What named-by-hand.example.com is called').fill('Named By Hand Tours')
  await row.getByRole('button', { name: 'Save name' }).click()
  await expect(row).toContainText('Known as Named By Hand Tours')

  await page.reload()
  await expect(row).toContainText('Known as Named By Hand Tours')

  // Tidy up, so a rerun starts from the same place.
  await row.getByRole('button', { name: /Remove/ }).click()
  await expect(row).toHaveCount(0)
})
