import { redirect } from 'next/navigation'
import { getToken } from '@/lib/session'

/**
 * The findings inbox is a top-level route rather than a /dashboard child, so it carries its own
 * auth gate. The Classical shell and fonts now live in the root layout, so there is nothing to
 * set up here beyond the token check.
 */
export default async function FindingsLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login')
  return <>{children}</>
}
