import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { themeScript } from '@/components/theme-script'
import { siteUrl } from '@/lib/site'
import './globals.css'

/**
 * Classical is the whole app's design system now, so the two serif faces load once here and
 * the `classical` class turns the token layer on for every page. Individual pages read from the
 * tokens; none of them re-declare the fonts.
 *
 * Self-hosted from ./fonts rather than fetched with next/font/google. The Google variant downloads
 * the files at build time, and that download failed CI twice in one day with a webpack TypeError
 * inside next/font, unrelated to the change under review. Both faces are variable fonts under the
 * SIL Open Font License (licence texts alongside), latin subset, one file each for every weight.
 */
const cormorant = localFont({
  src: './fonts/cormorant-garamond-latin.woff2',
  weight: '300 700',
  variable: '--font-cormorant',
  display: 'swap',
})
const lora = localFont({
  src: './fonts/lora-latin.woff2',
  weight: '400 700',
  variable: '--font-lora',
  display: 'swap',
})

const TITLE = 'RankWright: the SEO agent that opens pull requests'
const DESCRIPTION =
  'RankWright audits your site across eight separate areas and opens pull requests that fix what it finds. You review and merge, and it rechecks the result once it is live.'

/**
 * What every page inherits, and so only what is true of every page.
 *
 * There is no canonical here, and that is the point. It used to be set to `/` in this file, and
 * a layout's metadata is inherited: every page that did not set its own, which was all of them,
 * told search engines it was a copy of the homepage. Our own rule for that is TECH-023. Each
 * indexable page now names itself, and a page that says nothing has no canonical, which is
 * honest.
 *
 * The title is a template for the same reason. One title on twenty pages is TECH-012, and it is
 * also twenty identical browser tabs.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'RankWright',
  title: { default: TITLE, template: '%s | RankWright' },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'RankWright',
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    locale: 'en_GB',
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The font variables sit on <html>, not <body>: globals.css declares --font-heading and
    // --font-body on :root in terms of them, and a custom property resolves where it is declared,
    // so on <body> they were undefined at :root and every heading fell back to Georgia.
    <html lang="en" suppressHydrationWarning className={`${cormorant.variable} ${lora.variable}`}>
      <head>
        {/*
          Runs before first paint, so a user who chose dark never sees a frame of light paper.
          `suppressHydrationWarning` above is required because this script legitimately mutates
          the html element before React sees it.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="classical min-h-screen antialiased">
        {/* The first tab stop on every page, for anyone who does not use a mouse. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
