'use client'

import type { AuditCadence } from '@seo/api-client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ErrorNote, SavedNote } from '@/components/ui/error-note'
import type { UserError } from '@/lib/user-error'
import { setAuditCadence } from './actions'

/**
 * How often the site is audited without anybody pressing Run audit.
 *
 * Three choices and no Save button: choosing one saves it, and the calendar under it is drawn
 * again from the new answer. The choice shown is always the one stored, so a save that failed
 * snaps back and says why.
 */
const OPTIONS: { value: AuditCadence; label: string }[] = [
  { value: 'off', label: 'Only when I ask' },
  { value: 'weekly', label: 'Every 7 days' },
  { value: 'monthly', label: 'Every 30 days' },
]

const SAVED: Record<AuditCadence, string> = {
  off: 'Scheduled audits are off. Run one whenever you like from the top of any page.',
  weekly: 'This site is now audited every 7 days. The next one is on the calendar below.',
  monthly: 'This site is now audited every 30 days. The next one is on the calendar below.',
}

export function AuditCadenceControl({
  siteId,
  cadence,
}: {
  siteId: string
  cadence: AuditCadence
}) {
  const router = useRouter()
  const [stored, setStored] = useState(cadence)
  const [error, setError] = useState<UserError | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function choose(next: AuditCadence) {
    if (next === stored) return
    setError(null)
    setSaved(null)
    start(async () => {
      const result = await setAuditCadence(siteId, next)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStored(result.data)
      setSaved(SAVED[result.data])
      // No loading file on this route, so a refresh redraws the calendar in place.
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 border-0 p-0" disabled={pending}>
        <legend className="card-kicker mb-2 p-0">Audit this site</legend>
        <div className="seg">
          {OPTIONS.map((option) => (
            <label key={option.value} className="seg-opt">
              <input
                type="radio"
                name="audit-cadence"
                value={option.value}
                checked={stored === option.value}
                onChange={() => choose(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="text-muted max-w-[68ch] text-[13px]">
        Reading and scoring the site is free. An audit also groups your pages by topic, which uses a
        little of your monthly allowance each time, so this is off until you turn it on.
      </div>
      <ErrorNote error={error} />
      {saved && <SavedNote>{saved}</SavedNote>}
    </div>
  )
}
