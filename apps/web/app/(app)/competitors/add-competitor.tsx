'use client'

import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { CompetitorsEditor } from '@/app/(app)/site/competitors-editor'

/**
 * Add a competitor from the page that is about competitors.
 *
 * The list is edited on site setup, which is the right home for it and the wrong place to have
 * to go when you are looking at the watch and think of one more. This opens the same editor over
 * the page: type a domain, or ask for suggestions and tick them. It is the same component site
 * setup uses, so there is one list and one set of rules, reached from two places.
 *
 * Each change saves at once, so closing has nothing to confirm. The page is refreshed on close,
 * only if something changed, so the watch below shows the new competitor as not yet read.
 */
export function AddCompetitor({ siteId, tracked }: { siteId: string; tracked: string[] }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const changed = useRef(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  function closed() {
    setOpen(false)
    if (changed.current) {
      changed.current = false
      router.refresh()
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" />
        Add competitor
      </button>

      <dialog ref={dialog} className="sheet" onClose={closed} aria-labelledby="add-competitor">
        {open && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="add-competitor" className="h-section m-0" style={{ fontSize: 22 }}>
                  Your competitors
                </h2>
                <div className="text-muted mt-1 text-[13px]">
                  Add one by its web address, or ask for suggestions. A new competitor is read on
                  the next weekly check.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm shrink-0"
                onClick={() => dialog.current?.close()}
              >
                <X size={16} aria-hidden="true" />
                <span className="sr-only">Close</span>
              </button>
            </div>

            <CompetitorsEditor
              siteId={siteId}
              initial={tracked}
              onChange={() => {
                changed.current = true
              }}
            />

            <div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dialog.current?.close()}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
