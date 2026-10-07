'use client'

import { useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { loadBusinessProfile, saveBusinessProfile } from './actions'

/**
 * The Google Business Profile this site belongs to, connected by pasting one link.
 *
 * The local axis needs two identifiers that live in Google's index and nowhere on the site: the
 * CID, which is what a `hasMap` or `sameAs` link should point at, and the Place ID, which is what
 * a "leave a review" link is built from. Asking a client for either by name would get a blank
 * look. Asking them to press Share in Maps and paste the result is something they have already
 * done to send their address to somebody.
 *
 * So the field takes the share link and the API does the decoding, and the panel then shows the
 * two derived links rather than the raw identifiers, because the links are the part a person can
 * click to check we read their profile and not the shop next door.
 */
export function BusinessProfile({
  siteId,
  siteUrl,
  label = 'Google Business Profile',
}: {
  siteId: string
  siteUrl: string
  /** What the closed button says: "Add profile" or "Change", depending on the current state. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [link, setLink] = useState('')
  const [mapsUrl, setMapsUrl] = useState<string | null>(null)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }

    setError(null)
    setSaved(null)
    start(async () => {
      const answer = await loadBusinessProfile(siteId)
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data
      setMapsUrl(result.mapsUrl)
      setReviewUrl(result.reviewUrl)
      // The stored profile link doubles as the field's value, so re-saving is a no-op rather
      // than a way to accidentally clear it.
      setLink(result.mapsUrl ?? '')
      setOpen(true)
    })
  }

  function save(value: string | null) {
    setError(null)
    setSaved(null)
    start(async () => {
      const answer = await saveBusinessProfile(siteId, value)
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      const result = answer.data

      setMapsUrl(result.mapsUrl)
      setReviewUrl(result.reviewUrl)
      setLink(result.mapsUrl ?? '')
      setSaved(
        result.cid === null && result.placeId === null
          ? 'Disconnected. Local checks will show the profile as not connected.'
          : result.placeId === null
            ? 'Connected. This link identifies your listing but not its review page, so only ' +
              'the map link is available.'
            : 'Connected.',
      )
    })
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={pending}>
          {pending ? 'Loading...' : label}
        </button>
        <ErrorNote error={error} />
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{
        // Opens inside a narrow action slot on the setup checklist; keep the form usable.
        width: 'min(32rem, 100%)',
        padding: 'var(--space-4)',
        marginTop: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <div className="card-kicker">Google Business Profile for {siteUrl}</div>
        <div className="text-muted mt-2 text-[13px]" style={{ lineHeight: 1.6 }}>
          Open your business in Google Maps, press Share, and paste the link here. It tells us
          exactly which listing is yours, so the agent can add a real map link and a leave-a-review
          link to your site. Use the link from the Share button; a link copied from a search results
          page usually does not work.
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Google Maps share link</span>
        <input
          className="input"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://maps.app.goo.gl/..."
        />
      </label>

      {(mapsUrl || reviewUrl) && (
        <div style={{ fontSize: 12, opacity: 0.75, display: 'grid', gap: 'var(--space-1)' }}>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="break-all">
              Profile: {mapsUrl}
            </a>
          )}
          {reviewUrl && (
            <a href={reviewUrl} target="_blank" rel="noreferrer" className="break-all">
              Review link: {reviewUrl}
            </a>
          )}
        </div>
      )}

      <div
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => save(link.trim() || null)}
          disabled={pending}
        >
          {pending ? 'Saving...' : 'Save'}
        </button>
        {(mapsUrl || reviewUrl) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => save(null)}
            disabled={pending}
          >
            Disconnect
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Close
        </button>
      </div>

      <ErrorNote error={error} />
      {saved && !error && <SavedNote>{saved}</SavedNote>}
    </div>
  )
}
