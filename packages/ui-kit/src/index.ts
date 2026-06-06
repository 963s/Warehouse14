/**
 * @warehouse14/ui-kit — public surface.
 *
 * Six brand primitives ship in Phase 2 Day 2:
 *   Button, ParchmentCard, RomanIndex (+ toRoman), Seal, DiamondRule, MagnifierIcon
 *
 * Day 3 adds: StatTile, MoneyAmount, LedgerEntry.
 * Day 5 adds: PinPad, Toast, ToastContainer, ErrorBoundary.
 */

export { Button, type ButtonProps } from './components/Button.js';
export { ParchmentCard, type ParchmentCardProps } from './components/ParchmentCard.js';
export { RomanIndex, type RomanIndexProps, toRoman } from './components/RomanIndex.js';
export { Seal, type SealProps } from './components/Seal.js';
export { DiamondRule, type DiamondRuleProps } from './components/DiamondRule.js';
export { MagnifierIcon, type MagnifierIconProps } from './components/MagnifierIcon.js';

// Day 3 primitives
export { StatTile, type StatTileProps } from './components/StatTile.js';
export { MoneyAmount, type MoneyAmountProps } from './components/MoneyAmount.js';
export { LedgerEntry, type LedgerEntryProps } from './components/LedgerEntry.js';

// Day 5 primitives — Operational Foundations
export { PinPad, type PinPadProps } from './components/PinPad.js';
export { Toast, type ToastProps, type ToastShape, type ToastTone } from './components/Toast.js';
export {
  ToastContainer,
  type ToastContainerProps,
} from './components/ToastContainer.js';
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
} from './components/ErrorBoundary.js';

// UX P0 — Foundation: shared Dialog/Sheet + Form primitives. Every dialog
// used to be hand-rolled; these give one consistent, accessible core.
export {
  Dialog,
  type DialogProps,
  DialogHeader,
  DialogBody,
  DialogFooter,
  ModalShell,
  type ModalShellProps,
  type ModalSize,
} from './components/Dialog.js';
export { Sheet, type SheetProps } from './components/Sheet.js';
export {
  Accordion,
  type AccordionProps,
  AccordionItem,
  type AccordionItemProps,
} from './components/Accordion.js';
export { Popover, type PopoverProps } from './components/Popover.js';
export {
  Sparkline,
  type SparklineProps,
  type SparklineTone,
} from './components/Sparkline.js';

// Generic-action icon system (lucide-react). Brand motifs (Seal, DiamondRule,
// MagnifierIcon) stay; Icon/IconButton are for universal actions.
export { Icon, type IconProps } from './components/Icon.js';
export {
  AmountPad,
  type AmountPadProps,
  type AmountPadKey,
  amountPadReduce,
} from './components/AmountPad.js';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonTone,
} from './components/IconButton.js';
export type { LucideIcon } from 'lucide-react';
// Curated action set — consumers import these from the ui-kit, not lucide directly.
export {
  Trash2,
  Search,
  Plus,
  X,
  ChevronLeft,
  Printer,
  Pencil,
  Check,
  Percent,
  Tag,
  Wallet,
  LogIn,
  Lock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  FileText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
export { Field, type FieldProps } from './components/Field.js';
export { Input, type InputProps } from './components/Input.js';
export { Textarea, type TextareaProps } from './components/Textarea.js';
export { Select, type SelectProps } from './components/Select.js';
export { Checkbox, type CheckboxProps } from './components/Checkbox.js';
