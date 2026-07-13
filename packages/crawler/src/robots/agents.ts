/**
 * The AI crawler taxonomy.
 *
 * There are five functionally distinct kinds of AI user agent, and a single
 * `Disallow: /` cannot make all five decisions correctly. The distinction that
 * matters commercially:
 *
 *   - Blocking a TRAINING crawler stops your content being used to train a model.
 *     That is a legitimate business choice with no cost to your visibility.
 *
 *   - Blocking a SEARCH crawler deletes you from ChatGPT and Perplexity answers.
 *     These are the bots that make you citable. This is almost never intended.
 *
 * The most common and most damaging misconfiguration on the web right now is a
 * site that copy-pasted a 2023 "block the AI scrapers" robots.txt and took out
 * OAI-SearchBot and PerplexityBot along with GPTBot, while Bytespider (which
 * ignores robots.txt anyway) carries on regardless. That is rule TECH-002.
 */

export type AgentCategory =
  /** Crawl to train a model. Blocking these costs you nothing in visibility. */
  | 'training'
  /** Crawl to build a retrieval index. Blocking these makes you uncitable. */
  | 'search'
  /** Fetch a page because a user asked, in the moment. Often ignore robots.txt by design. */
  | 'user_triggered'
  /** Not crawlers. Tokens that opt you out of training without touching Search ranking. */
  | 'opt_out'

export interface AiAgent {
  token: string
  category: AgentCategory
  operator: string
  /** What actually happens to the business if this agent is disallowed. */
  consequenceIfBlocked: string
}

export const AI_AGENTS: readonly AiAgent[] = [
  // Training. Blocking is a legitimate choice.
  {
    token: 'GPTBot',
    category: 'training',
    operator: 'OpenAI',
    consequenceIfBlocked: 'Your content is not used to train OpenAI models. Visibility unaffected.',
  },
  {
    token: 'ClaudeBot',
    category: 'training',
    operator: 'Anthropic',
    consequenceIfBlocked:
      'Your content is not used to train Anthropic models. Visibility unaffected.',
  },
  {
    token: 'CCBot',
    category: 'training',
    operator: 'Common Crawl',
    consequenceIfBlocked:
      'You leave the Common Crawl corpus, which many models and researchers train on.',
  },
  {
    token: 'anthropic-ai',
    category: 'training',
    operator: 'Anthropic (legacy token)',
    consequenceIfBlocked: 'Legacy Anthropic training token. Visibility unaffected.',
  },
  {
    token: 'Meta-ExternalAgent',
    category: 'training',
    operator: 'Meta',
    consequenceIfBlocked: 'Your content is not used to train Meta models. Visibility unaffected.',
  },
  {
    token: 'Bytespider',
    category: 'training',
    operator: 'ByteDance',
    consequenceIfBlocked:
      'Nominally blocked. Bytespider is widely reported to ignore robots.txt, so treat this as a request, not a control.',
  },

  // Search and retrieval. Blocking these is the expensive mistake.
  {
    token: 'OAI-SearchBot',
    category: 'search',
    operator: 'OpenAI',
    consequenceIfBlocked:
      'CRITICAL: you cannot be cited in ChatGPT search results. You have removed yourself from the answer.',
  },
  {
    token: 'Claude-SearchBot',
    category: 'search',
    operator: 'Anthropic',
    consequenceIfBlocked: 'CRITICAL: you cannot be cited when Claude searches the web.',
  },
  {
    token: 'PerplexityBot',
    category: 'search',
    operator: 'Perplexity',
    consequenceIfBlocked: 'CRITICAL: you cannot be cited in Perplexity answers.',
  },

  // User-triggered. A human asked for this page, right now.
  {
    token: 'ChatGPT-User',
    category: 'user_triggered',
    operator: 'OpenAI',
    consequenceIfBlocked:
      'A ChatGPT user who explicitly asks about your page cannot be shown it. Note these fetchers often ignore robots.txt by design.',
  },
  {
    token: 'Claude-User',
    category: 'user_triggered',
    operator: 'Anthropic',
    consequenceIfBlocked: 'A Claude user who explicitly asks about your page cannot be shown it.',
  },
  {
    token: 'Perplexity-User',
    category: 'user_triggered',
    operator: 'Perplexity',
    consequenceIfBlocked: 'A Perplexity user following a link to your page may be blocked.',
  },
  {
    token: 'Google-NotebookLM',
    category: 'user_triggered',
    operator: 'Google',
    consequenceIfBlocked: 'Users cannot pull your page into NotebookLM.',
  },

  // Opt-out tokens. Not crawlers at all: they control training without touching Search.
  {
    token: 'Google-Extended',
    category: 'opt_out',
    operator: 'Google',
    consequenceIfBlocked:
      'Opts you out of Gemini training. Does NOT affect Google Search ranking or AI Overviews, which use the regular index.',
  },
  {
    token: 'Applebot-Extended',
    category: 'opt_out',
    operator: 'Apple',
    consequenceIfBlocked:
      'Opts you out of Apple Intelligence training. Does not affect Siri search.',
  },
]

export const SEARCH_AGENTS: readonly AiAgent[] = AI_AGENTS.filter((a) => a.category === 'search')

export function agentsByCategory(category: AgentCategory): readonly AiAgent[] {
  return AI_AGENTS.filter((a) => a.category === category)
}
