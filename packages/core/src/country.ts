/**
 * Every market keyword research can ask about, as ISO 3166-1 alpha-2 codes.
 *
 * The API already accepts any code and turns it into the location DataForSEO expects; what was
 * missing was a way to choose one that did not require knowing that "ke" means Kenya. Names come
 * from the runtime's own Intl data, so they are correct without a hand-kept table of names.
 */
const CODES = (
  'ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs ' +
  'bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee ' +
  'eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm ' +
  'hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc ' +
  'li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na ' +
  'nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw ' +
  'sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to ' +
  'tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'
).split(' ')

const KNOWN = new Set(CODES)

export interface CountryOption {
  code: string
  name: string
}

/** Every country, by English name. */
export function countryOptions(): CountryOption[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  return CODES.map((code) => ({ code, name: names.of(code.toUpperCase()) ?? code.toUpperCase() }))
    .filter((option) => option.name !== option.code.toUpperCase())
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isCountryCode(value: string | undefined): value is string {
  return Boolean(value && KNOWN.has(value.toLowerCase()))
}

/**
 * Country-code domains that are sold and used as generic ones, so they say nothing about where
 * the business is: a .io startup is not in the British Indian Ocean Territory.
 */
const GENERIC_CCTLDS = new Set(['io', 'co', 'ai', 'me', 'tv', 'cc', 'fm', 'ws', 'gg'])

/**
 * The market a site most likely serves, from its country-code domain, or undefined.
 * soliangirls.sc.ke is Kenya; example.co.uk is the United Kingdom; example.com says nothing.
 */
export function countryFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
  const tld = host.split('.').pop() ?? ''
  if (GENERIC_CCTLDS.has(tld)) return undefined
  const code = tld === 'uk' ? 'gb' : tld
  return KNOWN.has(code) ? code : undefined
}

/** The English name of a country code, e.g. 'ke' becomes 'Kenya'. */
export function countryName(code: string): string {
  return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
}
