import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Pressable } from 'react-native';

const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center justify-center gap-2 rounded-md shadow-none',
    Platform.select({
      web: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    })
  ),
  {
    variants: {
      variant: {
        // Primary = BRASS. The brand fill, cream label, one soft whisper of shadow.
        default: cn(
          'bg-primary active:bg-primary/90 shadow-sm shadow-black/5',
          Platform.select({ web: 'hover:bg-primary/90' })
        ),
        // Destructive = TERRACOTTA at full strength on both schemes (the palette
        // already lifts it for dark; never wash it to /60). Cream label.
        destructive: cn(
          'bg-destructive active:bg-destructive/90 shadow-sm shadow-black/5',
          Platform.select({
            web: 'hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
          })
        ),
        // Outline = the cream canvas inside a fine gold hairline. Press dips into
        // the sunken cream well (`secondary`), never the sage `accent` (which
        // means "positive" — a wire we never cross).
        outline: cn(
          'border-border bg-background active:bg-secondary dark:bg-input/30 dark:border-input dark:active:bg-input/50 border shadow-sm shadow-black/5',
          Platform.select({
            web: 'hover:bg-secondary dark:hover:bg-input/50',
          })
        ),
        // Secondary = the sunken cream well itself.
        secondary: cn(
          'bg-secondary active:bg-secondary/80 shadow-sm shadow-black/5',
          Platform.select({ web: 'hover:bg-secondary/80' })
        ),
        // Ghost = bare; press settles onto the sunken cream well, not sage.
        ghost: cn(
          'active:bg-secondary dark:active:bg-secondary/60',
          Platform.select({ web: 'hover:bg-secondary dark:hover:bg-secondary/60' })
        ),
        link: '',
      },
      size: {
        default: cn('h-11 px-4 py-2', Platform.select({ web: 'has-[>svg]:px-3' })),
        sm: cn('h-9 gap-1.5 rounded-md px-3', Platform.select({ web: 'has-[>svg]:px-2.5' })),
        lg: cn('h-12 rounded-md px-6', Platform.select({ web: 'has-[>svg]:px-4' })),
        // Money-path comfortable target (48px) — DESIGN.md §8 touch sizing.
        xl: cn('h-12 rounded-md px-6', Platform.select({ web: 'has-[>svg]:px-4' })),
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const buttonTextVariants = cva(
  cn(
    'text-foreground text-sm font-semibold',
    Platform.select({ web: 'pointer-events-none transition-colors' })
  ),
  {
    variants: {
      variant: {
        default: 'text-primary-foreground',
        // Warm cream label on the terracotta fill — never cold pure white.
        destructive: 'text-destructive-foreground',
        // Outline/ghost label stays the warm ink; the press tints the surface,
        // not the text (no sage `accent-foreground` flash on press).
        outline: '',
        secondary: 'text-secondary-foreground',
        ghost: '',
        link: cn(
          'text-primary group-active:underline',
          Platform.select({ web: 'underline-offset-4 hover:underline group-hover:underline' })
        ),
      },
      size: {
        default: '',
        sm: 'text-sm',
        lg: 'text-base',
        xl: 'text-base',
        icon: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonProps = React.ComponentProps<typeof Pressable> & React.RefAttributes<typeof Pressable> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(props.disabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        role="button"
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
