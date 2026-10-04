import { createServer, request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { pinnedAddress, startEgressProxy } from '../src/crawl/proxy.js'

describe('pinned browser egress', () => {
  it('rejects rebinding and mixed public/private DNS answers on every connection', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    expect(await pinnedAddress('changing.example', { resolve })).toBe('93.184.216.34')
    await expect(pinnedAddress('changing.example', { resolve })).rejects.toThrow('refused')
    await expect(
      pinnedAddress('split.example', {
        resolve: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ],
      }),
    ).rejects.toThrow('refused')
  })
  it.each(['127.0.0.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]'])(
    'refuses literal %s',
    async (host) => {
      await expect(pinnedAddress(host)).rejects.toThrow('refused')
    },
  )
  it('connects to the inspected IP without resolving the target hostname a second time', async () => {
    const origin = createServer((req, res) => res.end(req.headers.host))
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve))
    const address = origin.address()
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind')
    const resolve = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }])
    const proxy = await startEgressProxy({ allowPrivateNetwork: true, resolve })
    try {
      const body = await new Promise<string>((done, reject) => {
        const req = request(
          proxy.server,
          { path: `http://does-not-exist.invalid:${address.port}/` },
          (res) => {
            let body = ''
            res.on('data', (chunk) => {
              body += chunk
            })
            res.on('end', () => done(body))
          },
        )
        req.on('error', reject)
        req.end()
      })
      expect(body).toBe(`does-not-exist.invalid:${address.port}`)
      expect(resolve).toHaveBeenCalledTimes(1)
    } finally {
      await proxy.close()
      await new Promise<void>((resolve) => origin.close(() => resolve()))
    }
  })
})
