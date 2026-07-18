import { Cormorant_Garamond, Lora } from 'next/font/google'
import { redirect } from 'next/navigation'
import { getToken } from '@/lib/session'

/**
 * The Classical shell. This route opts the findings inbox into the Classical design system: the
 * two serif faces are loaded here and exposed as CSS variables, and the `classical` class turns
 * on the token layer and the light ground. The auth gate matches the dashboard's: everything in
 * here is behind a token.
 */
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})
const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-lora',
  display: 'swap',
})

export default async function FindingsLayout({ children }: { children: React.ReactNode }) {
  if (!(await getToken())) redirect('/login')

  return (
    <div
      className={`classical ${cormorant.variable} ${lora.variable}`}
      style={{ minHeight: '100vh' }}
    >
      {children}
    </div>
  )
}
