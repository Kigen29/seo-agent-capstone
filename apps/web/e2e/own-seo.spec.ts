import { expect, test, type Page } from '@playwright/test'

/**
 * Our own site, held to the rules we apply to other people's.
 *
 * Each test here is one of our audit rules pointed at ourselves, and each one failed before it
 * was written. A tool that tells a site its pages all share a canonical, while its own pages
 * all share a canonical, has no business being believed.
 */

const TOKEN = 'seo_e2e_fixed_token_do_not_use_in_production'

async function signIn(page: Page) {
  // By domain and path, as the other specs do: the config chooses the port.
  await page
    .context()
    .addCookies([{ name: 'seo_token', value: TOKEN, domain: '127.0.0.1', path: '/' }])
}

const canonicalOf = (page: Page) =>
  page
    .locator('link[rel="canonical"]')
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname))

const robotsOf = (page: Page) =>
  page
    .locator('meta[name="robots"]')
    .evaluateAll((tags) => tags.map((tag) => tag.getAttribute('content') ?? '').join(','))

/** Heading levels in document order, for the "skips a level" rule (TECH-011). */
const headingLevels = (page: Page) =>
  page
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))))

function skips(levels: number[]): string[] {
  const found: string[] = []
  for (let index = 1; index < levels.length; index++) {
    const before = levels[index - 1]!
    const now = levels[index]!
    if (now > before + 1) found.push(`h${before} to h${now}`)
  }
  return found
}

test('each public page names itself as canonical, and no page borrows the homepage', async ({
  page,
}) => {
  // TECH-023: different pages declaring one canonical.
  await page.goto('/')
  expect(await canonicalOf(page)).toEqual(['/'])

  await page.goto('/check')
  expect(await canonicalOf(page)).toEqual(['/check'])

  // Not a search result, so it claims no canonical at all rather than somebody else's.
  await page.goto('/login')
  expect(await canonicalOf(page)).toEqual([])
  expect(await robotsOf(page)).toContain('noindex')
})

test('every page has its own title, and one first-level heading', async ({ page }) => {
  // TECH-012: pages sharing a title.
  const titles = new Map<string, string>()
  for (const path of ['/', '/check', '/login']) {
    await page.goto(path)
    titles.set(path, await page.title())
    await expect(page.locator('h1')).toHaveCount(1)
  }

  await signIn(page)
  for (const path of [
    '/dashboard',
    '/findings',
    '/audits',
    '/outcomes',
    '/schedule',
    '/keywords',
    '/authority',
    '/visibility',
    '/competitors',
    '/topics',
    '/site',
    '/settings',
    '/settings/account',
    '/settings/connections',
    '/profile',
  ]) {
    await page.goto(path)
    await expect(page.locator('h1').first()).toBeVisible()
    titles.set(path, await page.title())
    // Nothing behind the sign-in is a search result.
    expect(await robotsOf(page), path).toContain('noindex')
  }

  const seen = new Map<string, string>()
  for (const [path, title] of titles) {
    expect(title, path).not.toBe('')
    expect(title, path).toContain('RankWright')
    expect(seen.get(title), `${path} shares its title with ${seen.get(title)}`).toBeUndefined()
    seen.set(title, path)
  }
})

test('the public pages do not skip a heading level', async ({ page }) => {
  // TECH-011. The landing page used to go from its h1 straight to an h4.
  for (const path of ['/', '/check', '/login']) {
    await page.goto(path)
    expect(skips(await headingLevels(page)), path).toEqual([])
  }
})

test('the landing page has a main landmark the skip link reaches', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('main#main')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
})

test('there is an llms.txt, and it does not claim to help rankings', async ({ request }) => {
  // AGENT-001: no llms.txt.
  const response = await request.get('/llms.txt')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/plain')
  const body = await response.text()
  expect(body.startsWith('# RankWright')).toBe(true)
  expect(body).toContain('/check')
  expect(body).not.toMatch(/improve[sd]? (your )?(google )?ranking|rank higher|boost/i)
  // The house rule on prose.
  expect(body).not.toContain('—')
})

test('the sitemap lists the pages we want found, with no invented dates', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(200)
  const xml = await response.text()
  expect(xml).toMatch(/<loc>[^<]+\/check<\/loc>/)
  // A lastmod of "now" on every read is a date that is never true.
  expect(xml).not.toContain('<lastmod>')
  // TECH-005: a noindexed page in the sitemap.
  expect(xml).not.toContain('/login')
  expect(xml).not.toContain('/dashboard')
})

test('the site has an icon', async ({ page }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="icon"]').first().getAttribute('href')
  expect(href).toBeTruthy()
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
})
