import { redirect } from 'next/navigation'
import { AppNav } from '@/components/app-nav'
import { getToken } from '@/lib/session'

/**
 * The gate. Everything under /dashboard is behind it, so a page cannot forget to check: it
 * would have to be moved out of this segment, which is a visible act rather than an omission.
 * The nav is full-width; each page owns its own centred container below it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login')

  return (
    <>
      <AppNav active="level" />
      {children}
    </>
  )
}
