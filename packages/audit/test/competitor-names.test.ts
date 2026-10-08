import { describe, expect, it, vi } from 'vitest'
import { nameCompetitors, type ReadHomepage } from '../src/competitor-names.js'

/**
 * A competitor is named by its own homepage title, under the rule the client's name is.
 *
 * What matters is what the map ends up holding, because each of its three states makes the next
 * poll do something different: use a name, stop asking, or ask again.
 */
const homepages =
  (titles: Record<string, string | null | undefined>): ReadHomepage =>
  async (url) => {
    const host = new URL(url).hostname
    if (!(host in titles)) return null
    return { title: titles[host] ?? null }
  }

describe('nameCompetitors', () => {
  it('takes the name a homepage title plainly states', async () => {
    const found = await nameCompetitors(
      ['mufasatours.com'],
      {},
      homepages({ 'mufasatours.com': 'Mufasa Tours | Safaris from Nairobi' }),
    )

    expect(found).toEqual({ 'mufasatours.com': 'Mufasa Tours' })
  })

  it('records "no name" when the title does not state one, so it is not fetched again', async () => {
    const found = await nameCompetitors(
      ['rival.example'],
      {},
      homepages({ 'rival.example': 'Home | Welcome', 'untitled.example': null }),
    )

    // Present, and null: read, and nothing to use. Not a guess from the domain.
    expect(found).toEqual({ 'rival.example': null })
  })

  it('leaves a site that did not answer out, so the next run tries again', async () => {
    const found = await nameCompetitors(['down.example'], {}, homepages({}))

    expect(found).toEqual({})
    expect('down.example' in found).toBe(false)
  })

  it('does not let one failing fetch cost the others their names', async () => {
    const read: ReadHomepage = async (url) => {
      if (url.includes('broken')) throw new Error('socket hang up')
      return { title: 'Mufasa Tours | Safaris' }
    }

    const found = await nameCompetitors(['broken.example', 'mufasatours.com'], {}, read)

    expect(found).toEqual({ 'mufasatours.com': 'Mufasa Tours' })
  })

  it('asks nothing about a competitor it already has an answer for, name or null', async () => {
    const read = vi.fn<ReadHomepage>(async () => ({ title: 'New Rival | Tours' }))

    const found = await nameCompetitors(
      ['named.example', 'nameless.example', 'newrival.com'],
      { 'named.example': 'Named', 'nameless.example': null },
      read,
    )

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('https://newrival.com')
    expect(found).toEqual({ 'newrival.com': 'New Rival' })
  })

  it('reads nothing when there is nobody to name', async () => {
    const read = vi.fn<ReadHomepage>()

    expect(await nameCompetitors([], {}, read)).toEqual({})
    expect(read).not.toHaveBeenCalled()
  })
})
