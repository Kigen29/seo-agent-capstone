import type { ImageWeight } from './images.js'
import type { MobileRender } from './mobile.js'
import type { OutboundLink } from './outbound.js'
import type { PageExtract } from '../page/types.js'
import type { RenderComparison } from '../page/render.js'
import type { RobotsTxt } from '../robots/parse.js'
import type { AiCrawlerPosture } from '../robots/posture.js'
import type { BlockedRequest } from './egress.js'
import type { FrontierState } from './frontier.js'

export interface CrawledPage {
  /** The URL we asked for. */
  url: string
  /** Where we ended up. Different from `url` means a redirect. */
  finalUrl: string
  status: number
  headers: Record<string, string>
  /** Every hop, in order. More than one hop is TECH-008. */
  redirectChain: string[]
  depth: number
  fetchedAt: string

  /** The bytes the server sent, before any JavaScript ran. */
  preJsHtml: string
  /** The DOM after JavaScript ran. This is what Google indexes. */
  renderedHtml: string

  extract: PageExtract
  render: RenderComparison

  /**
   * X-Robots-Tag, which does the same job as the robots meta tag but from the headers,
   * and is far easier to set by accident on a whole directory and never notice.
   */
  xRobotsTag?: string

  /** JPEG, downscaled. Evidence for PR bodies. Optional: it dominates storage. */
  screenshot?: Buffer

  /** Set when the fetch failed outright. The page is still recorded, with status 0. */
  error?: string
}

export interface SkippedUrl {
  url: string
  reason: string
}

export interface CrawlResult {
  /** Actual root-resource observations; absent metadata cannot prove a fix. */
  resources?: { robots: boolean; llmsTxt: boolean; sitemaps: boolean }
  pages: CrawledPage[]
  /** URLs we deliberately did not fetch, and why. Mostly robots.txt disallows. */
  skipped: SkippedUrl[]

  /**
   * The parsed robots.txt the crawl actually obeyed.
   *
   * Returned rather than left for the caller to fetch again. Every consumer of a crawl
   * needs it, re-fetching means a second request to someone else's origin for bytes we
   * already have, and a robots.txt that changed between the two fetches would mean the
   * audit reports on a file the crawl never obeyed.
   *
   * `absent` when the site has no robots.txt, which means no restrictions.
   */
  robots: RobotsTxt

  /** Which AI crawlers this robots.txt lets in. Derived from `robots`; TECH-002 reads it. */
  posture: AiCrawlerPosture

  /** The site's llms.txt, the root file that helps AI agents navigate it, or null if absent. */
  llmsTxt: string | null

  /** Every URL the sitemap declared, whether or not we reached it. */
  sitemapUrls: string[]

  /** Sitemap URLs discovered but never reached by following links: orphan candidates. */
  sitemapOnlyUrls: string[]

  /**
   * Requests the egress guard refused: a crawled page reaching for a private address, or a root
   * file redirecting to one. Optional so results built elsewhere (the quick check) stay valid.
   */
  blocked?: BlockedRequest[]

  /**
   * What became of the external links the pages carry: still there, gone, or could not be told.
   * Absent when the check was skipped. See outbound.ts for why "could not load" is not "broken".
   */
  outbound?: OutboundLink[]

  /** A sample of pages rendered again at phone width. Absent when the check was skipped. */
  mobile?: MobileRender[]

  /** The declared size and type of the images the pages use. Absent when the check was skipped. */
  images?: ImageWeight[]

  /** Resumable snapshot. Persist this after every page. */
  state: FrontierState
}
