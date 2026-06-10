import type { ReactNode } from "react";
import { MetalTicker } from "@/components/metal-ticker";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

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
