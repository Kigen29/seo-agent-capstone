import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * The shadcn convention, and it earns its place here for a reason this codebase learned the hard
 * way. `DESIGN.md` records that a hand-written component class loses a specificity fight with a
 * Tailwind utility (`.classical .nav` is (0,2,0), `md:hidden` is (0,1,0), so the utility loses
 * regardless of the media query), and that one shipped.
 *
 * `twMerge` addresses the neighbouring problem: two utilities in the same class string that set
 * the same property, where the winner is decided by stylesheet order rather than by which one the
 * caller wrote last. It resolves those in favour of the caller, which is what a component taking
 * a `className` prop needs to be honest about overriding.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
