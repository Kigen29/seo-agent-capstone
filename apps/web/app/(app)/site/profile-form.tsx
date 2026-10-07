'use client'

import type { SiteProfile } from '@seo/api-client'
import { useId, useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import type { UserError } from '@/lib/user-error'
import { saveProfile } from './actions'

/**
 * The three things a site says about itself: its name, what it offers, where its customers are.
 *
 * Used on the site page and as a step of onboarding, which is why saving is reported through
 * `onSaved` as well as shown here: onboarding moves on, the site page stays put.
 *
 * The name is usually already filled in. It is read from the homepage title when the site is
 * added, and this is where a wrong reading is corrected.
 */
export function ProfileForm({
  siteId,
  profile,
  submitLabel = 'Save details',
  onSaved,
}: {
  siteId: string
  profile: SiteProfile
  submitLabel?: string
  onSaved?: (profile: SiteProfile) => void
}) {
  const [brand, setBrand] = useState(profile.brand ?? '')
  const [offering, setOffering] = useState(profile.offering ?? '')
  const [market, setMarket] = useState(profile.market ?? '')
  const [error, setError] = useState<UserError | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const id = useId()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    start(async () => {
      const result = await saveProfile(siteId, { brand, offering, market })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      onSaved?.(result.data)
    })
  }

  return (
    <form
      onSubmit={submit}
      className="card"
      style={{ padding: 'var(--space-5)', gap: 'var(--space-4)' }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id={`${id}-brand`}
          label="Brand name"
          hint={{
            about: 'the brand name',
            body: 'The name of the business as a journalist would write it, with its spaces and capitals. We read it from your homepage title when the title states it. It is used to find who mentions you across the web, so a wrong name finds nothing.',
          }}
        >
          <input
            id={`${id}-brand`}
            className="input"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            placeholder="Heartbeest Safaris"
            maxLength={200}
          />
        </Field>

        <Field
          id={`${id}-market`}
          label="Where your customers are"
          hint={{
            about: 'where your customers are',
            body: 'A country, a city or a region, in your own words. Competitors and questions are suggested for this market, so "Nairobi" and "East Africa" give different answers.',
          }}
        >
          <input
            id={`${id}-market`}
            className="input"
            value={market}
            onChange={(event) => setMarket(event.target.value)}
            placeholder="Kenya"
            maxLength={100}
          />
        </Field>
      </div>

      <Field
        id={`${id}-offering`}
        label="What you offer"
        hint={{
          about: 'what you offer',
          body: 'One sentence, the way you would say it to a customer. It is never published. It makes the suggested competitors and questions about your actual business, not about whatever your homepage title happens to say.',
        }}
      >
        <textarea
          id={`${id}-offering`}
          className="input"
          rows={2}
          value={offering}
          onChange={(event) => setOffering(event.target.value)}
          placeholder="Private guided safaris for small groups"
          maxLength={300}
          style={{ resize: 'vertical' }}
        />
      </Field>

      <ErrorNote error={error} />
      {saved && <SavedNote>Saved.</SavedNote>}

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
