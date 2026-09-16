'use client'

import * as Primitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * An on/off control that is a real `role="switch"`.
 *
 * A styled checkbox reads to a screen reader as a checkbox, which announces "checked" rather than
 * "on", and a div with an onClick announces nothing at all. Radix gives the right role, the space
 * and enter keys, and a disabled state that is actually inert.
 *
 * The track is the only rounded-full thing in the product, and it is deliberate: a switch that is
 * not pill-shaped does not read as a switch. `DESIGN.md` bans pills for buttons and tags, where
 * the shape carries no meaning; here it does.
 */
export function Switch({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-[var(--color-accent)] data-[state=unchecked]:bg-[var(--color-surface)]',
        className,
      )}
      style={{ borderColor: 'var(--color-divider)' }}
      {...props}
    >
      <Primitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full shadow-sm transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
        )}
        style={{ background: 'var(--color-raised)' }}
      />
    </Primitive.Root>
  )
}
