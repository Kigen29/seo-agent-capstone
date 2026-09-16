'use client'

import * as Primitive from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A menu, with the keyboard and focus behaviour done properly.
 *
 * This is the clearest case for bringing Radix in. The app had no menu at all, and the honest
 * alternatives were a row of permanently visible buttons, which is what the sidebar footer was, or
 * a hand-rolled popover. A hand-rolled one is where accessibility quietly goes: roving tabindex,
 * Escape to close, focus returning to the trigger, arrow keys, click-outside, `aria-expanded`, and
 * not trapping a screen reader inside a div. Every one of those is a thing to forget, and
 * `DESIGN.md` asks for `web-design-guidelines` to be run over any UI diff precisely because this
 * codebase has shipped that class of bug before.
 *
 * The styling is entirely Classical tokens. No colour is written here as a literal.
 */
export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuGroup = Primitive.Group

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[13rem] overflow-hidden p-1',
          // Radix sets these data attributes; the motion is small and respects reduced motion
          // through the global rule in classical.css rather than being disabled here.
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        style={{
          background: 'var(--color-raised)',
          border: '1px solid var(--color-divider)',
          borderRadius: 'var(--radius-md, 7px)',
          boxShadow: 'var(--shadow-md)',
        }}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: ComponentProps<typeof Primitive.Item> & { inset?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-[var(--color-surface)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn('card-kicker px-2 py-1.5', className)} {...props} />
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      className={cn('-mx-1 my-1 h-px', className)}
      style={{ background: 'var(--color-divider)' }}
      {...props}
    />
  )
}
