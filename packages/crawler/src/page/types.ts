export interface Heading {
  level: number
  text: string
}

export interface PageLink {
  /** The href exactly as written in the markup. */
  href: string
  /** Absolute, fragment stripped. Undefined when the href could not be resolved. */
  resolved?: string
  anchorText: string
  rel: string[]
  nofollow: boolean
  internal: boolean
}

export interface PageImage {
  src: string
  resolved?: string
  /**
   * null means the alt attribute is ABSENT. '' means it is present and empty.
   *
   * These are not the same thing and must never be collapsed. An empty alt is the
   * correct, deliberate markup for a decorative image; a missing alt is a defect.
   * A rule that treats them alike will nag people who did the right thing.
   */
  alt: string | null
  width?: number
  height?: number
  loading?: string
  fetchPriority?: string
}

export interface Hreflang {
  hreflang: string
  href: string
}

export interface MetaRobots {
  /** The raw content attribute, or null when there is no robots meta tag. */
  raw: string | null
  directives: string[]
  index: boolean
  follow: boolean
}

/** A subresource the page loads. Needed to detect mixed content on an HTTPS page. */
export interface PageResource {
  type: 'script' | 'stylesheet' | 'image' | 'iframe'
  url: string
  resolved?: string
}

/**
 * The landmark regions a page declares, counted.
 *
 * This is the accessibility tree's skeleton, and it is what an agent or a screen reader uses to
 * answer "where is the actual content" without heuristics over div soup. Counts rather than
 * booleans, because the interesting defects are at both ends: no `main` at all, and several `main`
 * elements, which is just as ambiguous as none.
 *
 * Both the element and its ARIA role count. `<main>` and `<div role="main">` are the same
 * statement to an accessibility tree, and a rule that only accepted the element would nag a site
 * that did the right thing the older way.
 */
export interface Landmarks {
  main: number
  nav: number
  header: number
  footer: number
}

export interface PageExtract {
  title: string | null
  metaDescription: string | null
  /** Resolved to absolute. A relative canonical is legal but a common source of bugs. */
  canonical: string | null
  metaRobots: MetaRobots
  headings: Heading[]
  h1s: string[]
  links: PageLink[]
  images: PageImage[]
  /** Successfully parsed JSON-LD blocks. */
  jsonLd: unknown[]
  /** A JSON-LD block that does not parse is invisible to Google, so it is a finding. */
  jsonLdErrors: string[]
  hreflang: Hreflang[]
  resources: PageResource[]
  /** The landmark regions the page declares. See {@link Landmarks}. */
  landmarks: Landmarks
  /**
   * The `lang` attribute on `<html>`, or null when it is absent.
   *
   * Null and `''` are both "we do not know what language this is", but they are recorded as null
   * either way: unlike an image's alt, there is no meaning to declaring an empty language.
   */
  lang: string | null
  text: string
  wordCount: number
}
