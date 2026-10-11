import { expect, test } from '@playwright/test'

/**
 * Dismissing a finding, and taking that back (ADR-0050).
 *
 * The claim under test: a person can say a finding will not be acted on, the page says so and
 * still says so after a reload, the finding leaves the list of what needs fixing, and one press
 * brings it back.
 *
 * It has a tenant of its own. The other seeded findings are counted by tests that run at the
 * same time as this one.
 */

const TOKEN = 'seo_e2e_dismiss_tenant_token_do_not_use'
const FINDING = '00000000-0000-4000-8000-0000000000d4'
const TITLE = 'https://dismiss.example.com/ has no canonical tag'

// One finding is changed and changed back.
test.describe.configure({ mode: 'default' })

test('a finding is dismissed, stays dismissed, and is reopened', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'seo_token', value: TOKEN, domain: '127.0.0.1', path: '/' }])

  await page.goto(`/findings/${FINDING}`)
  // The button is a client component: a press before the page is ready does nothing.
  await page.waitForLoadState('networkidle')

  const dismiss = page.getByRole('button', { name: /Dismiss as won.t fix/ })
  const note = page.getByText(/You dismissed this as won.t fix/)
  // The list draws each row twice, once for a narrow screen, and only one is shown.
  const listed = page.getByRole('link', { name: TITLE }).filter({ visible: true })

  // Left open by an interrupted run: put it back first, so the test starts from one place.
  if (await note.isVisible()) {
    await page.getByRole('button', { name: 'Reopen' }).click()
  }
  await expect(dismiss).toBeVisible()
  await expect(note).toHaveCount(0)

  await dismiss.click()
  await expect(note).toBeVisible()
  await expect(dismiss).toHaveCount(0)

  // Stored, not only drawn.
  await page.reload()
  await expect(note).toBeVisible()

  // It is no longer among what needs fixing, and is still there to be found.
  await page.goto('/findings?status=open')
  await expect(listed).toHaveCount(0)
  await page.goto('/findings?status=wontfix')
  await expect(listed).toHaveCount(1)

  await page.goto(`/findings/${FINDING}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(dismiss).toBeVisible()
  await expect(note).toHaveCount(0)

  await page.goto('/findings?status=open')
  await expect(listed).toHaveCount(1)
})
