import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { SmoothScroll } from "@/components/smooth-scroll";
import { Providers } from "@/components/providers";

// next/font self-hosts these at build time (no runtime CDN call → DSGVO-safe).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Fraunces: a soft, characterful old-style serif. Warmer + more human than
// a neutral classic, fitting the natural/antique soul. Kept under the same
// CSS var so every `font-display` usage updates at once.
const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: {
    default: "warehouse14 · Gold, seltene Münzen & Antiquitäten",
    template: "%s · warehouse14",
  },
  description:
    "Das Haus für Anlagegold, seltene Münzen und geprüfte Antiquitäten. Echtzeit-Edelmetallkurse, versicherter Versand, GoBD- & GwG-konform. Schorndorf.",
  metadataBase: new URL("https://www.warehouse14.de"),
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: "warehouse14",
  },
};

// Render every route dynamically (SSR per request). This guarantees the
// catalog is fetched at RUNTIME from INTERNAL_API_URL (the internal Docker
// network) rather than baked at build time, and keeps the private internal view
// always-live. Low-traffic internal deployment → the per-request cost is moot.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-screen bg-surface text-ink antialiased">
        <Providers>
          <SmoothScroll>{children}</SmoothScroll>
        </Providers>
      </body>
    </html>
  );
}
