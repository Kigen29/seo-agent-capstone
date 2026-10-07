/**
 * The payment rail, behind a seam (ADR-0036).
 *
 * The same shape as `SerpProvider` and `VersionControlProvider`, for the same reason: which rail a
 * market pays on is the part most likely to change. Card payments through Stripe are one answer;
 * in Kenya the answer most customers would give is M-Pesa. Nothing above this interface knows
 * which is in use, so adding Daraja is an adapter and an environment variable.
 *
 * It is deliberately small. A provider can start a checkout and can read its own webhook, and
 * that is all: there is no method to charge a stored card, because nothing in this product should
 * be able to take money without a person approving it on the rail's own screen.
 */
export interface CheckoutRequest {
  tenantId: string
  planId: string
  /** What the buyer sees on the rail's checkout screen. */
  planName: string
  /** In the currency's minor unit. */
  priceMinor: number
  /** ISO 4217, lower case. */
  currency: string
  /** Where the rail sends the browser afterwards. The outcome is taken from the webhook, not these. */
  successUrl: string
  cancelUrl: string
}

/** What a verified webhook says happened, in terms the product understands. */
export type BillingEvent =
  | { kind: 'subscribed'; tenantId: string; planId: string }
  | { kind: 'cancelled'; tenantId: string }
  /** A real, verified event that changes nothing here (an invoice, a card update). */
  | { kind: 'ignored'; reason: string }

export interface BillingProvider {
  /** A stable name for logs and the UI, e.g. 'stripe'. */
  readonly name: string
  /** Always 'test' today. A provider that could answer 'live' has to be an ADR first. */
  readonly mode: 'test'
  /** Returns the address to send the buyer to. Takes no money itself. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>
  /**
   * Verify and read a webhook delivery. Throws `BillingSignatureError` when the delivery is not
   * provably from the rail, in which case the body must not be acted on or even trusted to log.
   */
  parseWebhook(rawBody: string, signatureHeader: string | undefined, now?: Date): BillingEvent
}

/** The delivery could not be proved to come from the rail. */
export class BillingSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingSignatureError'
  }
}

/**
 * A live credential was offered.
 *
 * The story's falsification condition is "a live charge is made in a demo". This is how that is
 * made impossible instead of merely unlikely: the adapter will not construct with a live key, so
 * there is no configuration of this deployment that can take real money.
 */
export class LiveBillingRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveBillingRefusedError'
  }
}
