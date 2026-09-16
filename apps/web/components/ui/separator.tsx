import * as Primitive from '@radix-ui/react-separator'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A rule between sections.
 *
 * Decorative by default, which is the correct choice almost always: a purely visual divider
 * announced to a screen reader is noise. Pass `decorative={false}` only when the line genuinely
 * separates two things a non-sighted user needs to know are separate.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      style={{ background: 'var(--color-divider)' }}
      {...props}
    />
  )
}
