import type { Site, SiteProfile } from '@seo/api-client'

/**
 * What is set up for a site, as a list that can be counted.
 *
 * The dashboard shows the count and the next thing to do; the site setup page shows every item
 * with its control. One list for both, so the number on the dashboard can never disagree with the
 * page it links to.
 *
 * Ordered by what unlocks the most: a repository is what turns findings into pull requests, so it
 * is the first thing suggested, and the optional items come last.
 */
export interface SetupStep {
  id:
    | 'details'
    | 'competitors'
    | 'repository'
    | 'search_console'
    | 'ownership'
    | 'business'
    | 'questions'
  /** Finishes the sentence "Next: ...". */
  next: string
  done: boolean
}

export function setupSteps(
  site: Site,
  google: { connected: boolean },
  profile: Pick<SiteProfile, 'brand' | 'offering' | 'market' | 'competitors'> | null,
): SetupStep[] {
  return [
    {
      id: 'details',
      next: 'say what you offer and where',
      done: Boolean(profile?.brand && profile.offering && profile.market),
    },
    {
      id: 'repository',
      next: 'connect your code repository, so fixes can arrive as pull requests',
      done: Boolean(site.repoFullName),
    },
    {
      id: 'search_console',
      next: 'connect Google Search Console, so real searches feed your audits',
      done: google.connected,
    },
    {
      id: 'competitors',
      next: 'choose the competitors you are compared with',
      done: (profile?.competitors.length ?? 0) > 0,
    },
    {
      id: 'questions',
      next: 'pick the questions to track in AI assistants',
      done: (site.trackedPrompts ?? 0) > 0,
    },
    {
      id: 'ownership',
      next: 'prove to Google that you own the site',
      done: site.gscVerificationStatus === 'verified',
    },
    {
      id: 'business',
      next: 'link your Google Business Profile',
      done: Boolean(site.businessProfileConnected),
    },
  ]
}

export function setupProgress(steps: SetupStep[]): {
  done: number
  total: number
  next: SetupStep | undefined
} {
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    next: steps.find((step) => !step.done),
  }
}
