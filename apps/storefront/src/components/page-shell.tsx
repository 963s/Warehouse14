import type { ReactNode } from "react";
import { MetalTicker } from "@/components/metal-ticker";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Kicker } from "@/components/brand/kicker";
import { BrandRule } from "@/components/brand/marks";

/**
 * Chrome wrapper for every inner route (catalog, product, cart, account,
 * legal, …). The home page composes its own hero-first layout; all other
 * pages wrap their content in PageShell so header + footer + ticker stay
 * consistent. Header is `solid` here (no transparent-over-hero behaviour).
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div id="top">
      <MetalTicker />
      <SiteHeader solid />
      <main className="min-h-[60vh]">{children}</main>
      <SiteFooter />
    </div>
  );
}

/**
 * Shared page header — kicker + display title + lead. Service and content
 * pages render this so the pattern (and its phone spacing) stays identical:
 * the house kicker (gilt ◆ + smallcaps eyebrow), fluid display title, one
 * readable lead line. `rule` optionally sets the plaque's hairline-◆-hairline
 * under the title, monochrome and quiet (the calm version of the divider).
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  rule = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  rule?: boolean;
}) {
  return (
    <header className="space-y-3">
      {eyebrow && <Kicker>{eyebrow}</Kicker>}
      <h1 className="font-display text-4xl font-semibold leading-tight text-ink md:text-5xl">
        {title}
      </h1>
      {rule && <BrandRule className="block w-36 text-ink/25" />}
      {lead && (
        <p className="measure pt-1 leading-relaxed text-ink-aged">{lead}</p>
      )}
    </header>
  );
}
