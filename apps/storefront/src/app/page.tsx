import { MetalTicker } from "@/components/metal-ticker";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Categories } from "@/components/categories";
import { FeaturedGrid } from "@/components/featured-grid";
import { ExplainerVideoSection } from "@/components/sections/explainer-video";
import { AnkaufProcess } from "@/components/ankauf-process";
import { NachlassBand } from "@/components/nachlass-band";
import { StatsBand } from "@/components/stats-band";
import { ValueProps } from "@/components/value-props";
import { Newsletter } from "@/components/newsletter";
import { SiteFooter } from "@/components/site-footer";

/* A focused, fast home: products and trust first. One storytelling moment,
 * the woven brand film (auto-plays in view, pure SVG, light identity), sits
 * mid-page; the other heavy showcase sections stay retired. */
export default function HomePage() {
  return (
    <div id="top">
      <MetalTicker />
      <SiteHeader />
      <main>
        <Hero />
        <Categories />
        <FeaturedGrid />
        <ValueProps />
        <ExplainerVideoSection />
        <AnkaufProcess />
        <NachlassBand />
        <StatsBand />
        <Newsletter />
      </main>
      <SiteFooter />
    </div>
  );
}
