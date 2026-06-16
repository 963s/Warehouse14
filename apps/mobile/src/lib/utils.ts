import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** RNR / shadcn class-merge helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
