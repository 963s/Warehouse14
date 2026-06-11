import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BadgeCheck, Package, ShieldCheck, type LucideIcon } from "lucide-react";

import { data, eur } from "@/lib/storefront-data";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
import { PhotoGallery } from "@/components/product/photo-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { UnikatBadge } from "@/components/product/scarcity-badge";
import { StickyBuyBar } from "@/components/product/sticky-buy-bar";
import { RelatedPieces } from "@/components/product/related-pieces";

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const p = await data.getProductBySlug(params.slug);
  if (!p) return {};
  return {
    title: p.seoTitle ?? `${p.name} | warehouse14`,
    description:
      p.seoDescription ??
      `${p.name} bei warehouse14 kaufen. Versicherter Versand, Echtheitsgarantie.`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True for unique/collectible pieces that earn the "Unikat" badge. */
function isUnikat(schemaOrgType: string | null): boolean {
  if (!schemaOrgType) return false;
  return schemaOrgType.toLowerCase().includes("collectible");
}

/**
 * True when the interactive 3D coin viewer should be offered.
 * Gold or silver coins only, not bars or antiques.
 */
// ── JSON-LD builder ───────────────────────────────────────────────────────────

function buildJsonLd(p: NonNullable<Awaited<ReturnType<typeof data.getProductBySlug>>>) {
  const type = p.schemaOrgType ?? "Product";
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": type,
    name: p.name,
    description: p.descriptionDe ?? undefined,
    sku: p.sku,
    offers: {
      "@type": "Offer",
      price: parseFloat(p.listPriceEur).toFixed(2),
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
    },
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ArtikelDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const p = await data.getProductBySlug(params.slug);
  if (!p) notFound();

  const jsonLd = buildJsonLd(p);
  const unikat = isUnikat(p.schemaOrgType);

  const breadcrumbs = [
    { href: "/", label: "Start" },
    ...(p.primaryCategory
      ? [
          {
            href: `/kategorien/${p.primaryCategory.slug}`,
            label: p.primaryCategory.nameDe,
          },
        ]
      : []),
    { href: "#", label: p.name },
  ];

  return (
    <PageShell>
      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <div className="max-w-edge mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb — one quiet line; only the product name truncates,
            so a long title never pushes the trail onto a second row */}
        <nav aria-label="Brotkrumenpfad" className="mb-6">
          <ol className="flex items-center gap-1.5 text-sm text-ink-faded">
            {breadcrumbs.map((crumb, idx) => (
              <li
                key={idx}
                className={
                  idx === breadcrumbs.length - 1
                    ? "flex min-w-0 items-center gap-1.5"
                    : "flex shrink-0 items-center gap-1.5"
                }
              >
                {idx > 0 && (
                  <span aria-hidden="true" className="text-ink-faded/50">
                    /
                  </span>
                )}
                {idx === breadcrumbs.length - 1 ? (
                  <span className="block truncate font-medium text-ink-aged">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="whitespace-nowrap py-2 transition-colors hover:text-ink"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>

        {/* 2-column: gallery | info */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Left: photo gallery */}
          <Reveal delay={0}>
            <PhotoGallery images={p.images} />
          </Reveal>

          {/* Right: product info. Order is tuned for the phone: name, price,
              then the action right away (thumb-reachable just under the
              gallery), the quiet trust line, and only then the longer read. */}
          <Reveal delay={0.08}>
            <div className="flex flex-col gap-6">
              {/* Category label */}
              {p.primaryCategory && (
                <Link
                  href={`/kategorien/${p.primaryCategory.slug}`}
                  className="eyebrow -my-3 flex min-h-[44px] w-fit items-center transition-colors duration-fast ease-hover hover:text-ink"
                >
                  {p.primaryCategory.nameDe}
                </Link>
              )}

              {/* Name */}
              <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
                {p.name}
              </h1>

              {/* Price + scarcity */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="tnum text-2xl font-semibold text-ink">
                  {eur(p.listPriceEur)}
                </span>
                {unikat && <UnikatBadge />}
              </div>

              {/* Add to cart — plus the quiet phone companion bar that rises
                  once the visitor scrolls past this primary action */}
              <div className="pt-1">
                <StickyBuyBar product={p} />
              </div>

              {/* Trust signals */}
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-faded">
                <TrustItem icon={ShieldCheck}>Versichert</TrustItem>
                <TrustItem icon={BadgeCheck}>Echtheitsgarantie</TrustItem>
                <TrustItem icon={Package}>Versicherter Versand</TrustItem>
              </ul>

              {/* Description */}
              {p.descriptionDe && (
                <p className="leading-relaxed text-ink-aged">{p.descriptionDe}</p>
              )}
            </div>
          </Reveal>
        </div>

        {/* Exponat-Karte */}
        <Reveal delay={0.1} className="mt-14">
          <SpecsTable product={p} />
        </Reveal>

        {/* Aus derselben Vitrine — siblings from the same category, same frame */}
        {p.primaryCategory && (
          <RelatedPieces
            categorySlug={p.primaryCategory.slug}
            categoryName={p.primaryCategory.nameDe}
            excludeId={p.id}
          />
        )}
      </div>
    </PageShell>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function TrustItem({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
      {children}
    </li>
  );
}
