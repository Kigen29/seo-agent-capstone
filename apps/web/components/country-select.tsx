import { countryOptions } from '@/lib/countries'

/**
 * Pick a market by name. Search volume is per country, so this is as much a part of a keyword
 * question as the term itself.
 */
export function CountrySelect({
  value,
  onChange,
  describedBy,
}: {
  value: string
  onChange: (code: string) => void
  describedBy?: string
}) {
  return (
    <select
      name="country"
      className="input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-describedby={describedBy}
    >
      {countryOptions().map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </select>
  )
}
