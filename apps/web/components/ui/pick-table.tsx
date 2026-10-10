'use client'

import { useId, type ReactNode } from 'react'
import { DataTable } from './data-table'

/**
 * A table of offers to tick: suggested competitors, suggested questions, mined questions.
 *
 * Three panels each drew this by hand, as a list of labels with a checkbox inside. It is the
 * shared `<DataTable>` with a first column of checkboxes, so thirty suggestions page like every
 * other list, and a tick made on page one is still made on page three because the choice is
 * held by the caller and not by the rows on screen.
 *
 * Nothing here applies a choice. The caller owns the button that does, and should say on it how
 * many are ticked, since some of them may be on a page that is not showing.
 */
export interface PickItem {
  /** What is stored when this is ticked, and what makes the row unique. */
  key: string
  title: ReactNode
  /** One line under the title: why it was suggested, or where it came from. */
  detail?: ReactNode
}

export function PickTable({
  label,
  heading,
  items,
  picked,
  onChange,
  pageSize = 8,
  className,
}: {
  /** What this is a table of, for screen readers. */
  label: string
  /** The heading over the offers, such as "Suggested competitor". */
  heading: string
  items: PickItem[]
  picked: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  pageSize?: number
  className?: string
}) {
  const id = useId()

  const toggle = (key: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(key)
    else next.delete(key)
    onChange(next)
  }

  return (
    <DataTable
      label={label}
      pageSize={pageSize}
      {...(className ? { className } : {})}
      columns={[{ header: 'Choose', hideHeader: true, className: 'w-px' }, { header: heading }]}
      rows={items.map((item, index) => ({
        key: item.key,
        cells: [
          <input
            key="tick"
            id={`${id}-${index}`}
            type="checkbox"
            className="mt-1"
            checked={picked.has(item.key)}
            onChange={(event) => toggle(item.key, event.target.checked)}
          />,
          // The label is the whole cell, so the text is as good a target as the box.
          <label key="what" htmlFor={`${id}-${index}`} className="block cursor-pointer">
            <span className="font-semibold">{item.title}</span>
            {item.detail && <span className="text-muted block text-[13px]">{item.detail}</span>}
          </label>,
        ],
      }))}
    />
  )
}
