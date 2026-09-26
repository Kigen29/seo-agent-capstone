import { describe, expect, it } from 'vitest'
import { createEgressGuard, type Resolve } from '../src/crawl/egress.js'

const answers =
  (table: Record<string, { address: string; family: number }[]>): Resolve =>
  async (hostname) => {
    const found = table[hostname]
    if (!found) throw new Error('ENOTFOUND')
    return found
  }

describe('createEgressGuard', () => {
  const guard = createEgressGuard({
    resolve: answers({
      'public.example': [{ address: '93.184.216.34', family: 4 }],
      'internal.example': [{ address: '10.1.2.3', family: 4 }],
      'split.example': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      'v6.example': [{ address: '2606:2800:220:1::1', family: 6 }],
      'empty.example': [],
    }),
  })

  it.each([
    'https://public.example/page',
    'http://public.example:8080/page',
    'wss://public.example/socket',
    'https://v6.example/',
    'https://93.184.216.34/',
    'data:text/plain,hello',
    'blob:https://public.example/1234',
  ])('allows %s', async (url) => {
    expect(await guard(url)).toBeNull()
  })

  it.each([
    ['http://169.254.169.254/latest/meta-data/', /private address/],
    ['http://127.0.0.1:5432/', /private address/],
    ['http://[::1]/', /private address/],
    ['http://[::ffff:10.0.0.1]/', /private address/],
    ['https://internal.example/', /resolves to a private address/],
    ['https://split.example/', /resolves to a private address/],
    ['https://unknown.example/', /could not be resolved/],
    ['https://empty.example/', /could not be resolved/],
    ['file:///etc/passwd', /scheme is not fetched/],
    ['ftp://public.example/', /scheme is not fetched/],
    ['not a url', /Not a valid URL/],
  ])('refuses %s', async (url, reason) => {
    expect(await guard(url)).toMatch(reason)
  })

  it('resolves each host once per crawl', async () => {
    let lookups = 0
    const counted = createEgressGuard({
      resolve: async () => {
        lookups += 1
        return [{ address: '93.184.216.34', family: 4 }]
      },
    })
    await Promise.all([
      counted('https://public.example/a'),
      counted('https://PUBLIC.example/b'),
      counted('https://public.example/c'),
    ])
    expect(lookups).toBe(1)
  })

  it('allows private destinations only when a test asks for it explicitly', async () => {
    const open = createEgressGuard({ allowPrivateNetwork: true })
    expect(await open('http://127.0.0.1/')).toBeNull()
  })
})
