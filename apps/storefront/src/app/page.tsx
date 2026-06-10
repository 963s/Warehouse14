import { MetalTicker } from "@/components/metal-ticker";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Categories } from "@/components/categories";
import { FeaturedGrid } from "@/components/featured-grid";
import { ExplainerVideoSection } from "@/components/sections/explainer-video";
import { Authentifizierung } from "@/components/sections/authentifizierung";
import { MotionExplainer } from "@/components/sections/motion-explainer";
import { IsometricJourney } from "@/components/sections/isometric-journey";
import { AnkaufProcess } from "@/components/ankauf-process";
import { StatsBand } from "@/components/stats-band";
import { ValueProps } from "@/components/value-props";
import { Newsletter } from "@/components/newsletter";
import { SiteFooter } from "@/components/site-footer";

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
        <Authentifizierung />
        <MotionExplainer />
        <IsometricJourney />
        <AnkaufProcess />
        <StatsBand />
        <Newsletter />
      </main>
      <SiteFooter />
    </div>
  );
}
