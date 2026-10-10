/**
 * How a date, a host, a count and an engine's name are written, everywhere.
 *
 * Each of these used to be written out where it was needed: the same host function in seven
 * files, the same date formatter in ten. They drifted, which is how one page came to show
 * "10 Oct 2026" and another "10/10/2026, 12:25:44 PM" for the same audit. The second form is
 * also ambiguous, since half its readers take 10/11 as October and half as November.
 *
 * One locale, named, so the server and the browser print the same thing and no page changes
 * when the machine it was rendered on does.
 */

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const DAY_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

type Moment = string | number | Date

/** "10 Oct 2026". */
export function formatDay(moment: Moment): string {
  return DAY.format(new Date(moment))
}

/** "10 Oct 2026, 12:25". For things that can happen more than once in a day. */
export function formatDayTime(moment: Moment): string {
  return DAY_TIME.format(new Date(moment))
}

/**
 * The host of an address, without `www.`: the name a person would call the site.
 *
 * Whatever was stored is returned as it is when it does not parse, because a site somebody
 * typed badly should still be shown as what they typed and not as nothing.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** "1 page", "2 pages". The count is always shown, so the noun has to agree with it. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** The answer engines, as their makers write them. The API reports them as lowercase ids. */
const ENGINE_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  claude: 'Claude',
  copilot: 'Copilot',
  'ai-overviews': 'Google AI Overviews',
  ai_overviews: 'Google AI Overviews',
  'ai-mode': 'Google AI Mode',
  ai_mode: 'Google AI Mode',
}

/** "ChatGPT, Perplexity". An id this does not know is shown as it came. */
export function engineNames(engines: readonly string[]): string {
  return engines.map((engine) => ENGINE_NAMES[engine.toLowerCase()] ?? engine).join(', ')
}
