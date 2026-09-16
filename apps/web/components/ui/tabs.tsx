'use client'

import * as Primitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tabs, with arrow-key navigation and the right ARIA wiring.
 *
 * `DESIGN.md` says filters, tabs and paging belong in the URL so a view can be linked and
 * restored. That still holds and is why the settings sections are separate routes rather than
 * client-side tabs: a link to the appearance settings has to survive being pasted into a message.
 *
 * This is for the case the rule does not cover, a small local switch inside one page where there
 * is nothing worth linking to on its own.
 */
export const Tabs = Primitive.Root

export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className={cn('seg self-start', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn('seg-opt data-[state=active]:is-active', className)}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn('mt-4 outline-none', className)} {...props} />
}
