import type { Metadata } from "next";
import { Inter, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SmoothScroll } from "@/components/smooth-scroll";
import { Providers } from "@/components/providers";

// next/font self-hosts these at build time (no runtime CDN call → DSGVO-safe).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Bricolage Grotesque: formal with creative character. Modern e-commerce
// voice, deliberately not the classical serif of the landing page.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

// JetBrains Mono: tabular numerics for prices, specs and live rates.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
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
    <html lang="de" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-surface text-ink antialiased">
        <Providers>
          <SmoothScroll>{children}</SmoothScroll>
        </Providers>
      </body>
    </html>
  );
}
