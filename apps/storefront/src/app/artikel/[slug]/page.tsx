import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { data, eur } from "@/lib/storefront-data";
import { PageShell } from "@/components/page-shell";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { Reveal } from "@/components/ui/reveal";
import { PhotoGallery } from "@/components/product/photo-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { UnikatBadge } from "@/components/product/scarcity-badge";

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
            href: `/kategorie/${p.primaryCategory.slug}`,
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
        {/* Breadcrumb */}
        <nav aria-label="Brotkrumenpfad" className="mb-6">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-faded">
            {breadcrumbs.map((crumb, idx) => (
              <li key={idx} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <span aria-hidden="true" className="text-ink-faded/50">
                    /
                  </span>
                )}
                {idx === breadcrumbs.length - 1 ? (
                  <span className="font-medium text-ink-aged">{crumb.label}</span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="transition-colors hover:text-ink"
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

          {/* Right: product info */}
          <Reveal delay={0.08}>
            <div className="flex flex-col gap-6">
              {/* Category label */}
              {p.primaryCategory && (
                <Link
                  href={`/kategorie/${p.primaryCategory.slug}`}
                  className="smallcaps text-sm text-gold hover:underline"
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

              {/* Description */}
              {p.descriptionDe && (
                <p className="leading-relaxed text-ink-aged">{p.descriptionDe}</p>
              )}

              {/* Add to cart */}
              <div className="pt-1">
                <AddToCartButton
                  product={p}
                  full
                  label="In den Warenkorb"
                />
              </div>

              {/* Trust signals */}
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-faded">
                <TrustItem icon="🔒">Versichert</TrustItem>
                <TrustItem icon="✓">Echtheitsgarantie</TrustItem>
                <TrustItem icon="📦">Versicherter Versand</TrustItem>
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Specs table */}
        <Reveal delay={0.1} className="mt-14">
          <SpecsTable product={p} />
        </Reveal>
      </div>
    </PageShell>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function TrustItem({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true">{icon}</span>
      {children}
    </li>
  );
}
