/**
 * Does a piece of text contain a name, as written?
 *
 * One answer to that question, used wherever the product decides that somebody else's words are
 * about a client: a search result offered as a mention of the brand (ADR-0039), and an AI
 * answer that names the brand without citing a source. Both had the same hole, in opposite
 * directions, because each had its own idea of what "contains the name" meant.
 */

/**
 * Letters and digits only, lower case, accents removed, everything else a single space.
 *
 * So "Heartbeest  Safaris", "heartbeest-safaris" and "HEARTBEEST SAFARIS" are one name, and a
 * text is not refused for a hyphen or a capital.
 */
export function plainText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Whether the name appears in the text as whole words, in order.
 *
 * `name` is the name as a person wrote it. Whole words, so "Heartbeest Safaris" is not found in
 * "Heartbeest Safarisland", and the whole name, so "Heartbeest" alone is not it. An empty name
 * matches nothing: a missing name must never be read as "found everywhere".
 */
export function containsName(text: string | null | undefined, name: string): boolean {
  if (!text) return false
  const wanted = plainText(name)
  if (!wanted) return false
  return ` ${plainText(text)} `.includes(` ${wanted} `)
}
