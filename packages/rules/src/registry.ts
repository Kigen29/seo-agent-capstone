import { AGENT_001 } from './rules/agent.js'
import {
  TECH_015,
  TECH_016,
  TECH_017,
  TECH_018,
  TECH_019,
  TECH_020,
  TECH_021,
} from './rules/content.js'
import { TECH_011, TECH_012 } from './rules/duplication.js'
import { TECH_005, TECH_006, TECH_007 } from './rules/indexation.js'
import { TECH_008, TECH_009, TECH_010 } from './rules/redirects.js'
import { TECH_001, TECH_002 } from './rules/robots.js'
import { TECH_003, TECH_004 } from './rules/sitemap.js'
import { TECH_013, TECH_014 } from './rules/structure.js'
import type { Rule } from './types.js'

/**
 * The rule registry. Adding a rule means writing it and adding it here, and nothing else
 * in the codebase changes.
 *
 * Rules are grouped by the surface they inspect rather than one file per rule: the twenty
 * files that would produce were each a dozen lines, and the grouping is what actually
 * carries meaning (everything that reads robots.txt lives together).
 */
export const ALL_RULES: readonly Rule[] = [
  TECH_001,
  TECH_002,
  TECH_003,
  TECH_004,
  TECH_005,
  TECH_006,
  TECH_007,
  TECH_008,
  TECH_009,
  TECH_010,
  TECH_011,
  TECH_012,
  TECH_013,
  TECH_014,
  TECH_015,
  TECH_016,
  TECH_017,
  TECH_018,
  TECH_019,
  TECH_020,
  TECH_021,
  AGENT_001,
]

export const ruleById = (id: string): Rule | undefined => ALL_RULES.find((rule) => rule.id === id)
