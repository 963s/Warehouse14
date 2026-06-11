import { BrandDiamond } from "./marks";
import { cn } from "@/lib/cn";

/**
 * The house kicker: the plaque's ◆ diamond in gilt, then the smallcaps
 * eyebrow line. This replaces every ad-hoc dot/pulse eyebrow — one opening
 * gesture for every section, straight off the shop sign.
 */
export function Kicker({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("eyebrow flex items-center gap-2.5", className)}>
      <BrandDiamond className="h-[8px] w-[8px] shrink-0 text-gilt" />
      <span>{children}</span>
    </p>
  );
}
