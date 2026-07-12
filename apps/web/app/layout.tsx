import type { Metadata } from 'next'
import { siteUrl } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Rankwright: the SEO agent that opens pull requests',
  description:
    'Every other AI-SEO tool sends your marketer a list. We send your repo a pull request.',
  alternates: { canonical: '/' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-200 antialiased">{children}</body>
    </html>
  )
}
