import type { ProductDetail } from "@/lib/storefront-data";
import { grams, fineness } from "@/lib/storefront-data";
import { Kicker } from "@/components/brand/kicker";

type Row = { label: string; value: string };

/**
 * Rows are built ONLY from fields the seam actually delivers — period,
 * origin, catalogReference, year and the metal facts. Nothing is invented;
 * a missing field simply leaves no row.
 */
function buildRows(p: ProductDetail): Row[] {
  const rows: Row[] = [];

  if (p.metal) {
    rows.push({ label: "Metall", value: p.metal });
  }

  if (p.weightGrams != null) {
    rows.push({ label: "Feingewicht", value: grams(p.weightGrams) });
  }

  if (p.finenessDecimal != null) {
    rows.push({ label: "Feinheit", value: fineness(p.finenessDecimal) });
  }

  if (p.yearMintedFrom != null) {
    const year =
      p.yearMintedTo != null && p.yearMintedTo !== p.yearMintedFrom
        ? `${p.yearMintedFrom} bis ${p.yearMintedTo}`
        : String(p.yearMintedFrom);
    rows.push({ label: "Prägejahr", value: year });
  }

  if (p.period) {
    rows.push({ label: "Periode", value: p.period });
  }

  if (p.originCountry) {
    rows.push({ label: "Herkunft", value: p.originCountry });
  }

  /* Some records carry the SKU as their catalog reference — showing the same
     value twice (Katalognummer + Artikelnummer) reads like a data error, so
     the row only appears when it adds information. */
  if (p.catalogReference && p.catalogReference !== p.sku) {
    rows.push({ label: "Katalognummer", value: p.catalogReference });
  }

  rows.push({ label: "Artikelnummer", value: p.sku });

  return rows;
}

/**
 * The Exponat-Karte — the archival label beside the piece, like the small
 * card in a museum vitrine. Smallcaps row labels, tnum values, hairline
 * rows; a single gilt thread along the top edge, the gilded rim of a rare
 * stamp. Quiet card, no decoration beyond the thread.
 */
export function SpecsTable({ product }: { product: ProductDetail }) {
  const rows = buildRows(product);

  if (rows.length === 0) return null;

  return (
    <section aria-label="Exponat-Karte">
      <Kicker className="mb-2">Exponat</Kicker>
      <h2 className="mb-4 font-display text-xl font-semibold text-ink">
        Angaben zum Stück
      </h2>

      <div className="relative overflow-hidden rounded-card border border-rule bg-card shadow-card">
        {/* the gilt thread — a 1px edge, never a fill */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gilt"
        />
        <dl className="divide-y divide-rule">
          {rows.map(({ label, value }) => (
            <div
              key={label}
              className="grid grid-cols-[1fr_1.6fr] gap-x-4 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-x-6 sm:px-5"
            >
              <dt className="smallcaps text-sm text-ink-faded">{label}</dt>
              <dd className="tnum text-sm font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
