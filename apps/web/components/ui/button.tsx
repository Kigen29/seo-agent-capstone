import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * The shadcn Button shape, wearing the Classical button.
 *
 * The variants map onto `.btn-*` in `classical.css` rather than re-declaring colours in Tailwind
 * utilities, and that is the whole integration strategy in one file. shadcn is copy-in components
 * you own, not a theme you adopt, so what is worth taking is the *architecture* (a typed variant
 * API, `asChild`, a `className` that genuinely overrides) and what is worth refusing is the look.
 * `DESIGN.md` is blunt that the default look, Inter and a violet primary and 8px radii, "is simply
 * not this product", and that a second design language in one app is the thing to avoid.
 *
 * So there is still exactly one place that decides what a primary button looks like, and it is
 * still the stylesheet. Change the gold there and every button here follows.
 *
 * `asChild` is the piece the old plain `<button>` could not do: it renders a `<Link>` or an `<a>`
 * with the button's appearance while keeping the correct element underneath. `DESIGN.md` asks for
 * `<button>` for actions and a link for navigation, and before this the only way to have a link
 * that looked like a button was to paste `className="btn btn-primary"` onto an anchor, which is
 * how the two drift apart.
 */
const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      danger: 'btn-danger',
    },
    size: {
      default: '',
      sm: 'btn-sm',
    },
    block: {
      true: 'btn-block',
      false: '',
    },
  },
  defaultVariants: { variant: 'secondary', size: 'default', block: false },
})

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element with the button's appearance, for a link that looks like one. */
    asChild?: boolean
  }

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button'

  return (
    <Component className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
  )
}

export { buttonVariants }
