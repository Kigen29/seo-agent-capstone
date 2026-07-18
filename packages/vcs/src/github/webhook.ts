import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify that a webhook really came from GitHub, before a single byte of it is trusted.
 *
 * GitHub signs every webhook delivery with an HMAC-SHA256 of the raw request body, keyed on
 * the secret we set when we registered the App, and sends it in the `X-Hub-Signature-256`
 * header as `sha256=<hex>`. Anyone can POST to a public URL; only GitHub can produce this
 * signature. The API must verify it before mapping a `pull_request` event to a finding,
 * because otherwise a forged body could move a finding to `merged` and trigger a verification
 * against a fix that was never made.
 *
 * Two details that are easy to get wrong and both matter:
 *  - The HMAC is over the exact raw bytes GitHub sent. Re-serialising a parsed JSON body will
 *    not match, so the caller must hand us the raw payload.
 *  - The comparison is constant-time. A byte-by-byte early return leaks, through timing, how
 *    much of a guessed signature was correct, which is enough to forge one over many tries.
 */

const PREFIX = 'sha256='

/** The header GitHub puts the signature in. */
export const SIGNATURE_HEADER = 'x-hub-signature-256'

/**
 * True when `signature` is GitHub's valid HMAC of `payload` under `secret`.
 *
 * `payload` is the raw request body, as a string or Buffer. `signature` is the full header
 * value including the `sha256=` prefix. Returns false, never throws, for a missing or
 * malformed signature, so a caller can treat "invalid" and "absent" the same way: reject.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string | Buffer,
  signature: string | undefined | null,
): boolean {
  if (!secret || !signature || !signature.startsWith(PREFIX)) return false

  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const expectedHeader = PREFIX + expected

  const a = Buffer.from(expectedHeader)
  const b = Buffer.from(signature)

  // timingSafeEqual throws on a length mismatch, which is itself a signal. Guard the length
  // first so a wrong-length signature is a plain false, not an exception.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
