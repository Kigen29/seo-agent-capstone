'use client'

import * as Primitive from '@radix-ui/react-avatar'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A profile picture that degrades to initials, and never to a broken image.
 *
 * The fallback is the reason this is a component rather than an `<img>`. A provider avatar can
 * fail to load, and a GitHub account that has never set one still returns a URL. Radix swaps in
 * the fallback on error rather than leaving a torn-image glyph, and it delays the swap slightly so
 * a fast connection does not flash initials before the picture arrives.
 *
 * Square with a small radius, not a circle. `DESIGN.md`: "Nothing here is a pill."
 */
export function Avatar({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn('relative flex size-9 shrink-0 overflow-hidden rounded', className)}
      style={{ background: 'var(--color-surface)' }}
      {...props}
    />
  )
}

export function AvatarImage({ className, ...props }: ComponentProps<typeof Primitive.Image>) {
  return <Primitive.Image className={cn('aspect-square size-full', className)} {...props} />
}

export function AvatarFallback({ className, ...props }: ComponentProps<typeof Primitive.Fallback>) {
  return (
    <Primitive.Fallback
      delayMs={300}
      className={cn('flex size-full items-center justify-center text-xs', className)}
      style={{ color: 'var(--color-text-muted)' }}
      {...props}
    />
  )
}

/** First letters of the name, or of the email, or a dash. Never an empty circle. */
export function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim()
  if (!source) return '\u2014'

  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}
