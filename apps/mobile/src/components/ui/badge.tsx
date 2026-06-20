import { cva, type VariantProps } from "class-variance-authority"
import { View, type ViewProps } from "react-native"

import { TextClassContext } from "@/components/ui/text"
import { cn } from "@/lib/utils"

/**
 * Badge — a compact status pill (Warehouse14 Owner OS).
 *
 * Pill shape (rounded-full, the one allowed circular exception for small
 * controls), a hairline for the `outline` variant, tight 4px-grid padding, and
 * a `semibold` label so a one-word status reads at a glance. The `dot` prop adds
 * a leading status dot tinted to the variant — the calm way to flag state in a
 * dense row without a heavy fill. Variant API is unchanged; surfaces that map a
 * domain status to a variant keep working.
 */
const badgeVariants = cva(
  "flex-row items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary",
        secondary: "border-transparent bg-secondary",
        destructive: "border-transparent bg-destructive",
        success: "border-transparent bg-accent",
        outline: "border-border bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

const badgeTextVariants = cva("text-xs font-semibold leading-tight", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      destructive: "text-destructive-foreground",
      success: "text-accent-foreground",
      outline: "text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

/** Dot tint per variant — the leading status dot when `dot` is set. */
const badgeDotVariants = cva("h-1.5 w-1.5 rounded-full", {
  variants: {
    variant: {
      default: "bg-primary-foreground",
      secondary: "bg-muted-foreground",
      destructive: "bg-destructive-foreground",
      success: "bg-accent-foreground",
      outline: "bg-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

type BadgeProps = ViewProps &
  VariantProps<typeof badgeVariants> & {
    /** Show a leading status dot tinted to the variant. */
    dot?: boolean
  }

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props}>
        {dot ? <View className={badgeDotVariants({ variant })} /> : null}
        {children}
      </View>
    </TextClassContext.Provider>
  )
}

export { Badge, badgeDotVariants, badgeTextVariants, badgeVariants }
export type { BadgeProps }
