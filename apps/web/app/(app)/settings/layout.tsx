import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsNav } from './nav'

/**
 * One frame for every settings screen.
 *
 * The sections are routes rather than client-side tabs, and that is `DESIGN.md`'s rule about
 * filters, tabs and paging belonging in the URL applied to settings: "the theme setting" has to be
 * a link somebody can paste, and the back button has to move between sections rather than out of
 * settings entirely.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Settings"
        title="Settings"
        description="How the app looks, what it is connected to, and what this account may spend."
      />

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <p className="text-muted mt-8 text-[13px]">
        Looking for your account? <Link href="/profile">Your profile</Link> has the identity you
        signed in with.
      </p>
    </main>
  )
}
