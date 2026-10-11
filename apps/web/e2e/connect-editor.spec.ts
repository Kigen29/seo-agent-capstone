import { expect, test, type Page } from '@playwright/test'

/**
 * Connecting an editor (ADR-0046).
 *
 * The claim under test: a signed-in person can make a token without anybody touching the
 * database, sees it exactly once, is handed a config that already contains it, and can revoke
 * it. And a token cannot be used to make another.
 */

// A browser session, seeded for the second tenant. The other fixed credentials are tokens.
const SESSION = 'seo_e2e_other_tenant_session_do_not_use'
const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'

// One account's token list is added to and removed from.
test.describe.configure({ mode: 'default' })

async function signIn(page: Page, credential: string) {
  await page
    .context()
    .addCookies([{ name: 'seo_token', value: credential, domain: '127.0.0.1', path: '/' }])
}

test('the config can be read before any token exists, and never turns writes on', async ({
  page,
}) => {
  await signIn(page, SESSION)
  await page.goto('/settings/account')
  // The form is a client component: typed text is lost if it arrives before the page is ready.
  await page.waitForLoadState('networkidle')

  const panel = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Connect your editor' }),
  })
  await expect(panel).toBeVisible()
  const command = panel.getByLabel('Run this in a terminal')
  await expect(command).toContainText('claude mcp add --env SEO_API_URL=')
  await expect(command).toContainText('seo_paste_your_token_here')
  // The switch is explained, and is in no config a person is handed.
  await expect(command).not.toContainText('SEO_MCP_ALLOW_WRITES')
  // No double dash and nothing dashed after the name: PowerShell eats the first and then
  // `claude` refuses the second.
  const text = (await command.textContent()) ?? ''
  expect(text.split(/\s+/)).not.toContain('--')
  expect(text).toMatch(/--scope user rankwright (npx|node) /)

  // Writes are a switch on the page, and ticking it changes what would be copied.
  const allow = panel.getByRole('checkbox', { name: /Let it start audits and open pull requests/ })
  await expect(allow).not.toBeChecked()
  await allow.check()
  await expect(command).toContainText('--env SEO_MCP_ALLOW_WRITES=1')
  await panel.getByRole('tab', { name: 'Cursor, VS Code and others' }).click()
  const json = JSON.parse(
    (await panel.getByLabel("Add this to your editor's MCP config file").textContent()) ?? '',
  )
  expect(json.mcpServers.rankwright.env.SEO_MCP_ALLOW_WRITES).toBe('1')
  await allow.uncheck()
  await expect(panel.getByLabel("Add this to your editor's MCP config file")).not.toContainText(
    'SEO_MCP_ALLOW_WRITES',
  )
})

test('a signed-in person makes a token, sees it once, and gets a config that contains it', async ({
  page,
}) => {
  await signIn(page, SESSION)
  await page.goto('/settings/account')
  // The form is a client component: typed text is lost if it arrives before the page is ready.
  await page.waitForLoadState('networkidle')
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Connect your editor' }),
  })

  await panel.getByLabel('Name').fill('Laptop, made in a test')
  await panel.getByLabel('Expires after').selectOption('30')
  await panel.getByRole('button', { name: 'Create token' }).click()

  await expect(panel.getByText(/created\. Copy it now\./)).toBeVisible()
  const shown = (await panel.getByLabel('Your token').textContent())?.trim() ?? ''
  expect(shown).toMatch(/^seo_[A-Za-z0-9_-]{20,}$/)

  // The config is filled in with it, in both forms, so what is copied works as pasted.
  await expect(panel.getByLabel('Run this in a terminal')).toContainText(shown)
  await panel.getByRole('tab', { name: 'Cursor, VS Code and others' }).click()
  const json = JSON.parse(
    (await panel.getByLabel("Add this to your editor's MCP config file").textContent()) ?? '',
  )
  expect(json.mcpServers.rankwright.env.SEO_API_TOKEN).toBe(shown)
  expect(json.mcpServers.rankwright.env.SEO_API_URL).toMatch(/^http/)

  // It is a working credential, and it is in the list under the panel without its value.
  const sites = await page.request.get('http://127.0.0.1:4111/sites', {
    headers: { authorization: `Bearer ${shown}` },
  })
  expect(sites.status()).toBe(200)
  const row = page.getByRole('row').filter({ hasText: 'Laptop, made in a test' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Token')
  await expect(page.getByRole('table', { name: 'Sessions and tokens' })).not.toContainText(shown)

  // A reload does not bring it back: it was shown once.
  await page.reload()
  await expect(page.locator('main')).not.toContainText(shown)

  // And revoking it stops it working.
  await page
    .getByRole('row')
    .filter({ hasText: 'Laptop, made in a test' })
    .getByRole('button', { name: /Revoke/ })
    .click()
  await expect(page.getByRole('row').filter({ hasText: 'Laptop, made in a test' })).toHaveCount(0)
  const after = await page.request.get('http://127.0.0.1:4111/sites', {
    headers: { authorization: `Bearer ${shown}` },
  })
  expect(after.status()).toBe(401)
})

test('a token cannot make a token, and the page says why', async ({ page }) => {
  // Signed in with a token and not a browser session, as somebody pasting one at sign-in is.
  await signIn(page, TOKEN)
  await page.goto('/settings/account')
  // The form is a client component: typed text is lost if it arrives before the page is ready.
  await page.waitForLoadState('networkidle')
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Connect your editor' }),
  })
  await panel.getByRole('button', { name: 'Create token' }).click()
  await expect(panel.getByRole('alert')).toContainText(/cannot create another token/)
  await expect(panel.getByLabel('Your token')).toHaveCount(0)
})

test('a token needs a name before anything is asked of the server', async ({ page }) => {
  await signIn(page, SESSION)
  await page.goto('/settings/account')
  // The form is a client component: typed text is lost if it arrives before the page is ready.
  await page.waitForLoadState('networkidle')
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Connect your editor' }),
  })
  await panel.getByLabel('Name').fill('   ')
  await panel.getByRole('button', { name: 'Create token' }).click()
  await expect(panel.getByRole('alert')).toContainText('Give the token a name')
})
