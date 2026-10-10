import type { ReactNode } from 'react'

/**
 * One month as a grid of days, Monday first.
 *
 * A real table, with a caption and a heading for each weekday, so a screen reader can say which
 * day a cell is and move by row and column. Each cell holds whatever the caller puts on that
 * day; this component knows what a month looks like and nothing about what is scheduled in it.
 *
 * The caller passes the days to draw, which are whole weeks, so the days that spill over from
 * the months either side are shown and dimmed and never left as blank squares.
 *
 * Drawn from `md` up. A seven-column grid on a phone gives each day about fifty pixels, which
 * holds a number and nothing else, so the caller shows a list there instead.
 */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface CalendarEntry {
  key: string
  node: ReactNode
}

export function MonthCalendar({
  label,
  month,
  days,
  today,
  entries,
  maxPerDay = 3,
}: {
  /** What this is a calendar of, for the caption. */
  label: string
  /** `YYYY-MM`. Days outside it are dimmed. */
  month: string
  /** Whole weeks of `YYYY-MM-DD`, in order. */
  days: string[]
  today: string
  entries: Map<string, CalendarEntry[]>
  /** How many entries a day shows before the rest are counted. */
  maxPerDay?: number
}) {
  const weeks: string[][] = []
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7))

  return (
    <div className="frame">
      <div className="table-scroll">
        <table className="month">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday} scope="col">
                  <span aria-hidden="true">{weekday.slice(0, 3)}</span>
                  <span className="sr-only">{weekday}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const list = entries.get(day) ?? []
                  const shown = list.slice(0, maxPerDay)
                  const hidden = list.length - shown.length
                  const classes = [
                    day.startsWith(month) ? '' : 'month-outside',
                    day === today ? 'month-today' : '',
                  ]
                    .join(' ')
                    .trim()
                  return (
                    <td
                      key={day}
                      className={classes || undefined}
                      aria-current={day === today ? 'date' : undefined}
                    >
                      <div className="month-day">
                        {Number(day.slice(8))}
                        {day === today && <span className="sr-only"> (today)</span>}
                      </div>
                      {shown.length > 0 && (
                        <ul className="month-entries">
                          {shown.map((entry) => (
                            <li key={entry.key}>{entry.node}</li>
                          ))}
                        </ul>
                      )}
                      {hidden > 0 && <div className="month-more">and {hidden} more</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
