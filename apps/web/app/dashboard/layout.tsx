import Link from 'next/link'
import { redirect } from 'next/navigation'
import { signOut } from '../login/actions'
import { getToken } from '@/lib/session'

/**
 * The gate. Everything under /dashboard is behind it, so a page cannot forget to check: it
 * would have to be moved out of this segment, which is a visible act rather than an omission.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-baseline justify-between border-b border-neutral-900 pb-4">
        <Link
          href="/dashboard"
          className="text-sm font-medium tracking-widest text-neutral-400 uppercase hover:text-neutral-200"
        >
          Rankwright
        </Link>

        <form action={signOut}>
          <button type="submit" className="text-sm text-neutral-600 hover:text-neutral-400">
            Sign out
          </button>
        </form>
      </header>

      {children}
    </div>
  )
}
