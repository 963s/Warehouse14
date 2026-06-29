import { cn } from '@/lib/utils';
import { Platform, TextInput } from 'react-native';

function Input({ className, ...props }: React.ComponentProps<typeof TextInput> & React.RefAttributes<TextInput>) {
  return (
    <TextInput
      className={cn(
        // Sunken cream well: `bg-input` (the raised/sunken surface #e8e4da) sits
        // below the card plane, framed by the fine gold hairline (`border-input`)
        // at the antique button radius (4). Depth is the layering + hairline, not
        // a heavy shadow — so just the one soft whisper.
        'border-input bg-input text-foreground flex h-11 w-full min-w-0 flex-row items-center rounded-md border px-3 py-2 text-base leading-5',
        props.editable === false &&
        cn(
          'opacity-50',
          Platform.select({ web: 'disabled:pointer-events-none disabled:cursor-not-allowed' })
        ),
        Platform.select({
          web: cn(
            'placeholder:text-ink-aged selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow] md:text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'
          ),
          native: 'placeholder:text-ink-aged',
        }),
        className
      )}
      {...props}
    />
  );
}

export { Input };
