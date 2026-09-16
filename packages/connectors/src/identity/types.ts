/**
 * Who somebody is, according to a provider they just proved they control.
 *
 * This is identity and nothing else. There is no access token here, no refresh token and no
 * scope list, because signing in does not need one: the product wants to know *who* this is, and
 * the grants it needs later (Search Console, a repository) are separate consents the user gives
 * deliberately, on a screen that says what they are for.
 *
 * Keeping them separate matters. A sign-in that quietly collected repository write access would
 * be asking for a capability under cover of a login button, which is the pattern that trains
 * people to click through consent screens without reading them.
 */
export interface SocialIdentity {
  /** 'github' or 'google'. */
  provider: string
  /**
   * The provider's own stable id for this account. Never the email.
   *
   * An email is a label the user controls and can change; this does not change for the life of
   * the account. Keying on the email would hand a second, empty tenant to anyone who updates
   * their address, and would let two people who ever shared an address collide.
   */
  accountId: string
  /** For display, and so a human can tell two accounts apart. Not an identifier. */
  email?: string
  name?: string
  avatarUrl?: string
}

/**
 * One social provider, reduced to the two things a sign-in needs.
 *
 * A Strategy seam, like `SerpProvider` and `VersionControlProvider`: the routes know that a
 * provider can produce a consent URL and turn a code into an identity, and nothing else. Adding
 * a third provider is a file here and a line in the registry, not a change to any route.
 */
export interface IdentityProvider {
  readonly name: string
  /** Where to send the browser to ask the user to prove who they are. */
  authUrl(state: string): string
  /** Trade the one-time code for an identity, or throw. */
  identify(code: string): Promise<SocialIdentity>
}

export interface IdentityProviderConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Injected so a test can answer without a network, exactly like the Google OAuth client. */
  fetch?: typeof globalThis.fetch
}
