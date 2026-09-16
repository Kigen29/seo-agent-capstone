'use client'

import * as Primitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A label that is genuinely associated with its control.
 *
 * Radix adds the click-to-focus behaviour and, more usefully, prevents text selection on a
 * double click, which is what makes a hand-rolled label feel wrong without anyone being able to
 * say why.
 */
export function Label({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn('text-sm leading-none peer-disabled:opacity-60', className)}
      {...props}
    />
  )
}
