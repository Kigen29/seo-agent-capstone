import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SIGNATURE_HEADER, verifyWebhookSignature } from '../src/github/webhook.js'

const SECRET = 'a-test-webhook-secret'
const PAYLOAD = JSON.stringify({ action: 'closed', pull_request: { merged: true } })

function sign(secret: string, payload: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
}

describe('webhook signature verification', () => {
  it('accepts a signature GitHub would have produced', () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, sign(SECRET, PAYLOAD))).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const signature = sign(SECRET, PAYLOAD)
    const tampered = PAYLOAD.replace('"merged":true', '"merged":false')
    expect(verifyWebhookSignature(SECRET, tampered, signature)).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, sign('not-the-secret', PAYLOAD))).toBe(false)
  })

  it('rejects an absent or malformed signature', () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, undefined)).toBe(false)
    expect(verifyWebhookSignature(SECRET, PAYLOAD, '')).toBe(false)
    expect(verifyWebhookSignature(SECRET, PAYLOAD, 'deadbeef')).toBe(false)
  })

  it('exports the header name GitHub uses', () => {
    expect(SIGNATURE_HEADER).toBe('x-hub-signature-256')
  })
})
