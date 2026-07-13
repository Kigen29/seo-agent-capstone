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
  text: string
  wordCount: number
}
