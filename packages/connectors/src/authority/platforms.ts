/**
 * Which sites are not editorial coverage, shared by the mention classifier and the link gap.
 */

/**
 * Sites anybody can publish to. A subdomain counts.
 *
 * One list for both classifiers. They ask different questions (the mention classifier: "did the
 * brand write this itself"; the link gap: "is asking for a link from this a real outreach task"),
 * but the answer about which sites anybody can post to is the same, and two copies had drifted:
 * a brand's own Flickr album was being counted as a publication that covered it.
 */
export const PLATFORMS: readonly string[] = [
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'tiktok.com',
  'youtube.com',
  'pinterest.com',
  'reddit.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'wixsite.com',
  'tumblr.com',
  'quora.com',
  'github.com',
  'flickr.com',
  'substack.com',
]

/**
 * Directories and citation sources.
 *
 * Short, obvious, and not an attempt to enumerate the web's directories, which is a list that
 * cannot be maintained honestly. What it does is stop the most common citation sources being
 * presented as journalism to pitch, and route them to the axis where a listing actually matters.
 */
export const DIRECTORIES: readonly string[] = [
  'yelp.com',
  'yellowpages.com',
  'yellowpageskenya.com',
  'brownbook.net',
  'cylex.com',
  'hotfrog.com',
  'foursquare.com',
  'tripadvisor.com',
  'trustpilot.com',
  'crunchbase.com',
  'bbb.org',
  'manta.com',
  'thomasnet.com',
  'europages.com',
  'kompass.com',
]

/** Whether a host is one of these, or a subdomain of one. */
export const matches = (host: string, list: readonly string[]): boolean =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`))
