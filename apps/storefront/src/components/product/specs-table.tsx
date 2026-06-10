import type { ProductDetail } from "@/lib/storefront-data";
import { grams, fineness } from "@/lib/storefront-data";

type Row = { label: string; value: string };

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
        ? `${p.yearMintedFrom}–${p.yearMintedTo}`
        : String(p.yearMintedFrom);
    rows.push({ label: "Prägejahr", value: year });
  }

  if (p.originCountry) {
    rows.push({ label: "Herkunft", value: p.originCountry });
  }

  if (p.catalogReference) {
    rows.push({ label: "Katalog-Nr.", value: p.catalogReference });
  }

  if (p.period) {
    rows.push({ label: "Periode", value: p.period });
  }

  return rows;
}

export function SpecsTable({ product }: { product: ProductDetail }) {
  const rows = buildRows(product);

  if (rows.length === 0) return null;

  return (
    <section aria-label="Technische Angaben">
      <h2 className="mb-4 font-display text-xl font-semibold text-ink">
        Technische Angaben
      </h2>

      <dl className="divide-y divide-rule rounded-card border border-rule bg-card shadow-card">
        {rows.map(({ label, value }) => (
          <div
            key={label}
            className="grid grid-cols-[1fr_1.6fr] gap-x-6 px-5 py-3 sm:grid-cols-[180px_1fr]"
          >
            <dt className="smallcaps text-sm text-ink-faded">{label}</dt>
            <dd className="tnum text-sm font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
