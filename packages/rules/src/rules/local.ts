import { normaliseUrl } from '@seo/crawler'
import { markupEvidence } from '../evidence.js'
import type { Rule } from '../types.js'

/**
 * LOCAL-001: the homepage shows contact details but no LocalBusiness structured data.
 *
 * The local axis is only meaningful for a business with a physical presence, and firing "no
 * LocalBusiness schema" on every site would bury a SaaS in noise about a thing it does not need.
 * So this rule fires only when the site itself demonstrates it is local: its structured data
 * already carries a postal address or a telephone, but no node is typed as a LocalBusiness (or a
 * subtype). That is the site saying "I am a local business" in one breath and not marking it up in
 * the next, which is exactly the actionable, fixable case, and it keeps the rule precise rather
 * than guessing at intent from plain-text addresses.
 *
 * Scoped to the homepage, where the primary business entity conventionally lives, and where a
 * single head edit can add the block.
 */
export const LOCAL_001: Rule = {
  id: 'LOCAL-001',
  axis: 'local',
  severity: 'medium',
  estimatedEffort: 'small',
  fixable: true,
  description:
    'The homepage has contact details but no LocalBusiness structured data, so it misses local features.',

  evaluate: (context) => {
    const seed = normaliseUrl(context.seed) ?? context.seed
    const home = context.pages.find(
      (page) => page.status === 200 && (normaliseUrl(page.finalUrl) ?? page.finalUrl) === seed,
    )
    if (!home) return []

    const nodes = flattenNodes(home.extract.jsonLd)
    if (nodes.some(isLocalBusiness)) return [] // already typed as a local business

    // A node that carries a postal address or a phone is the site telling us it is local.
    const contact = nodes.map(contactOf).find((c): c is Contact => c !== null)
    if (!contact) return []

    return [
      {
        title: `${home.finalUrl} has contact details but no LocalBusiness structured data`,
        // The evidence is the contact data we found, which is also exactly what the fixer needs to
        // build the LocalBusiness block, so it is carried as JSON here.
        evidence: markupEvidence(
          home,
          'script[type="application/ld+json"]',
          JSON.stringify(contact),
        ),
        affectedUrls: [home.finalUrl],
        confidence: 0.9,
        estimatedImpact: 35,
        falsification:
          `Re-crawl ${home.finalUrl} and look for a LocalBusiness (or subtype) JSON-LD block. If ` +
          "one is present, this was wrong. After the fix, Google's Rich Results Test should " +
          'recognise a LocalBusiness and the site becomes eligible for local result features. This ' +
          'is only meaningful for a business with a physical presence.',
      },
    ]
  },
}

type JsonObject = Record<string, unknown>

/** The contact fields the fixer needs to build a LocalBusiness block. */
export interface Contact {
  name?: string
  address?: unknown
  telephone?: string
}

/** Flatten JSON-LD blocks into their nodes, walking arrays and `@graph` containers. */
function flattenNodes(blocks: readonly unknown[]): JsonObject[] {
  const out: JsonObject[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      const node = value as JsonObject
      if ('@graph' in node) visit(node['@graph'])
      out.push(node)
    }
  }
  blocks.forEach(visit)
  return out
}

/** A node's `@type` values as an array of strings, whether it was a string or an array. */
function typesOf(node: JsonObject): string[] {
  const type = node['@type']
  if (typeof type === 'string') return [type]
  if (Array.isArray(type)) return type.filter((value): value is string => typeof value === 'string')
  return []
}

/**
 * Whether a node is a LocalBusiness or one of its subtypes.
 *
 * schema.org's LocalBusiness has dozens of subtypes; rather than track the whole tree, this matches
 * a curated set of the common ones plus the structural fact that nearly every local subtype's name
 * ends in `Business`, `Store`, `Shop`, `Restaurant`, or `Service`. Over-matching here only makes the
 * rule quieter (it decides the site already has local markup), which is the safe direction.
 */
const LOCAL_BUSINESS_TYPES = new Set([
  'LocalBusiness',
  'Restaurant',
  'Store',
  'Hotel',
  'LodgingBusiness',
  'FoodEstablishment',
  'Bakery',
  'Dentist',
  'Physician',
  'Attorney',
  'LegalService',
  'FinancialService',
  'AutomotiveBusiness',
  'RealEstateAgent',
  'TravelAgency',
  'BeautySalon',
  'HairSalon',
  'MedicalBusiness',
  'ProfessionalService',
  'HomeAndConstructionBusiness',
  'HealthAndBeautyBusiness',
])

const LOCAL_SUFFIX = /(Business|Store|Shop|Restaurant|Service|Salon)$/

function isLocalBusiness(node: JsonObject): boolean {
  return typesOf(node).some((type) => LOCAL_BUSINESS_TYPES.has(type) || LOCAL_SUFFIX.test(type))
}

/** The contact details on a node, or null when it carries neither an address nor a phone. */
function contactOf(node: JsonObject): Contact | null {
  const hasAddress = node['address'] !== undefined && typeof node['address'] === 'object'
  const telephone = typeof node['telephone'] === 'string' ? node['telephone'] : undefined
  if (!hasAddress && telephone === undefined) return null

  return {
    name: typeof node['name'] === 'string' ? node['name'] : undefined,
    address: hasAddress ? node['address'] : undefined,
    telephone,
  }
}
