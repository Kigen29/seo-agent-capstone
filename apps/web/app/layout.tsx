import type { Metadata } from 'next'
import { Cormorant_Garamond, Lora } from 'next/font/google'
import { siteUrl } from '@/lib/site'
import './globals.css'

/**
 * Classical is the whole app's design system now, so the two serif faces load once here and
 * the `classical` class turns the token layer on for every page. Individual pages read from the
 * tokens; none of them re-declare the fonts.
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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'RankWright: the SEO agent that opens pull requests',
  description: 'Most SEO tools hand you a report. We hand your repo a pull request.',
  alternates: { canonical: '/' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`classical ${cormorant.variable} ${lora.variable} min-h-screen antialiased`}>
        {children}
      </body>
    </html>
  )
}
