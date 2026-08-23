'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * The seed and the market, submitted into the URL.
 *
 * A form rather than the debounced-on-keystroke pattern the findings filter bar uses, and the
 * difference is money. Filtering the inbox re-runs a database query and costs nothing, so firing
 * it as you type is a kindness. Every search here is a billed request against a paid vendor,
 * charged per request and per row returned, so it happens when a human presses a button and at no
 * other time.
 *
 * The market matters as much as the term. Search volume is per-country, so leaving it blank does
 * not mean "everywhere", it means the United States, and a Kenyan business planning around US
 * demand is planning around somebody else's market.
 */
export function SeedForm({ seed, country }: { seed: string; country: string }) {
  const router = useRouter()
  const pathname = usePathname()

  const [value, setValue] = useState(seed)
  const [market, setMarket] = useState(country)
  const [pending, setPending] = useState(false)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const term = value.trim()
    if (!term) return

    setPending(true)
    const search = new URLSearchParams({ seed: term })
    if (market.trim()) search.set('country', market.trim().toLowerCase())
    router.push(`${pathname}?${search.toString()}`)
  }

  return (
    <form onSubmit={submit} className="card elev-sm gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="card-kicker">Seed term</span>
          <input
            name="seed"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setPending(false)
            }}
            placeholder="kenya safari…"
            autoComplete="off"
            spellCheck={false}
            className="input"
            aria-describedby="seed-help"
          />
        </label>

        <label className="flex w-[10rem] shrink-0 flex-col gap-1">
          <span className="card-kicker">Market</span>
          <input
            name="country"
            value={market}
            onChange={(event) => setMarket(event.target.value)}
            placeholder="ke"
            maxLength={2}
            autoComplete="country"
            spellCheck={false}
            className="input"
            aria-describedby="market-help"
          />
        </label>

        <button type="submit" className="btn btn-primary shrink-0" disabled={!value.trim()}>
          {pending ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Two separate descriptions, because the two inputs need different things said about them. */}
      <p id="seed-help" className="text-muted m-0 text-[13px]">
        This runs a billed query against a paid data source when you press Search.
      </p>
      <p id="market-help" className="text-muted m-0 text-[13px]">
        Market is a two-letter country code. Search volume is per-market, so leaving it blank means
        the United States, not everywhere.
      </p>
    </form>
  )
}
