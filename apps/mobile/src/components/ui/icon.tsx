import type { LucideIcon, LucideProps } from "lucide-react-native"
import { styled } from "nativewind"
import * as React from "react"

import { TextClassContext } from "@/components/ui/text"
import { cn } from "@/lib/utils"

type IconProps = LucideProps & {
  as: LucideIcon
} & React.RefAttributes<LucideIcon>

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />
}

// NativeWind v5 dropped `cssInterop`; `styled(Component, { className: 'style' })`
// is the equivalent. className → style, and Lucide's default `color="currentColor"`
// resolves from style.color, so `text-*` utilities tint the icon. Size is passed
// via the explicit `size` prop (default 16 == size-4).
const StyledIcon = styled(IconImpl, { className: "style" }) as React.ComponentType<IconProps>

/**
 * A wrapper for Lucide icons with NativeWind `className` support (color via
 * `text-*`). Use `size` for dimensions.
 *
 * @example <Icon as={ArrowRight} className="text-primary" size={16} />
 */
function Icon({ as: IconComponent, className, size = 16, ...props }: IconProps) {
  const textClass = React.useContext(TextClassContext)
  return (
    <StyledIcon
      as={IconComponent}
      className={cn("text-foreground", textClass, className)}
      size={size}
      {...props}
    />
  )
}

export { Icon }
