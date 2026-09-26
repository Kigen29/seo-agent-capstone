// The country list lives in @seo/core so the API (which suggests prompts per market) and the web
// app (which lets a person pick one) cannot disagree about which countries exist.
export { countryFromUrl, countryOptions, isCountryCode } from '@seo/core'
export type { CountryOption } from '@seo/core'
