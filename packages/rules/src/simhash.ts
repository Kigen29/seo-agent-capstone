/**
 * SimHash, for near-duplicate content detection (TECH-012).
 *
 * An exact hash is useless here: two product pages differing only in a price are
 * duplicates in Google's eyes but hash completely differently. SimHash produces a
 * fingerprint where similar documents give similar fingerprints, so nearness is a
 * Hamming distance and the comparison stays cheap and deterministic.
 */

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = (1n << 64n) - 1n

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET

  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }

  return hash
}

/**
 * Word-level shingles. Single words are too weak a signal (any two English pages share
 * most of their words); three-word runs capture phrasing, which is what actually repeats
 * in duplicated content.
 */
export function shingles(text: string, size = 3): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length < size) return words.length > 0 ? [words.join(' ')] : []

  const out: string[] = []
  for (let i = 0; i <= words.length - size; i += 1) {
    out.push(words.slice(i, i + size).join(' '))
  }
  return out
}

export function simhash(text: string): bigint {
  const features = shingles(text)
  if (features.length === 0) return 0n

  const weights = new Array<number>(64).fill(0)

  for (const feature of features) {
    const hash = fnv1a64(feature)

    for (let bit = 0; bit < 64; bit += 1) {
      const set = (hash >> BigInt(bit)) & 1n
      weights[bit] = (weights[bit] as number) + (set === 1n ? 1 : -1)
    }
  }

  let fingerprint = 0n
  for (let bit = 0; bit < 64; bit += 1) {
    if ((weights[bit] as number) > 0) fingerprint |= 1n << BigInt(bit)
  }

  return fingerprint
}

/** How many bits differ. 0 is identical; under ~4 is a near-duplicate in practice. */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b
  let distance = 0

  while (xor > 0n) {
    distance += Number(xor & 1n)
    xor >>= 1n
  }

  return distance
}
