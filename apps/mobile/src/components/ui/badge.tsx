import { cva, type VariantProps } from "class-variance-authority"
import { View, type ViewProps } from "react-native"

import { TextClassContext } from "@/components/ui/text"
import { cn } from "@/lib/utils"

const badgeVariants = cva("items-center self-start rounded-full border px-2 py-0.5", {
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
})

const badgeTextVariants = cva("text-xs font-medium", {
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

type BadgeProps = ViewProps & VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  )
}

export { Badge, badgeTextVariants, badgeVariants }
export type { BadgeProps }
