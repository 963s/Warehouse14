"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
import { data, eur } from "@/lib/storefront-data";
import type { OrderSummary } from "@/lib/storefront-data";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Ausstehend",
  PROCESSING: "In Bearbeitung",
  SHIPPED: "Versendet",
  DELIVERED: "Zugestellt",
  CANCELLED: "Storniert",
};

const SHIPPING_LABELS: Record<string, string> = {
  AWAITING: "Versand ausstehend",
  READY: "Versandbereit",
  IN_TRANSIT: "Unterwegs",
  DELIVERED: "Zugestellt",
};

function statusBadge(status: string): string {
  switch (status) {
    case "DELIVERED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "SHIPPED":
    case "PROCESSING":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "CANCELLED":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-surface text-ink-aged border-rule";
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export default function BestellungenPage() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    data
      .listOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-16 md:py-24 space-y-10">
        <Reveal>
          <div className="flex items-center gap-4">
            <Link
              href="/konto"
              className="text-ink-faded text-sm hover:text-gold transition-colors"
            >
              &larr; Mein Konto
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink">
              Meine Bestellungen
            </h1>
            <p className="text-ink-aged">
              Alle Bestellungen, die Sie bei Warehouse14 aufgegeben haben.
            </p>
          </div>
        </Reveal>

        {loading ? (
          <Reveal delay={0.08}>
            <div className="text-center py-16 text-ink-faded text-sm">
              Bestellungen werden geladen ...
            </div>
          </Reveal>
        ) : orders === null || orders.length === 0 ? (
          <Reveal delay={0.08}>
            <div className="bg-card border border-rule rounded-card shadow-card px-8 py-16 text-center space-y-5">
              <p className="text-4xl">📦</p>
              <h2 className="font-display text-xl font-semibold text-ink">
                Noch keine Bestellungen
              </h2>
              <p className="text-ink-aged text-sm leading-relaxed max-w-xs mx-auto">
                Sie haben bisher noch nichts bestellt. Stöbern Sie in unserer
                Kollektion aus Gold, Münzen und Antiquitäten.
              </p>
              <Link
                href="/kollektion"
                className="inline-block rounded-button bg-gold px-7 py-2.5 text-sm font-semibold text-white hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-gold/40 transition"
              >
                Zur Kollektion
              </Link>
            </div>
          </Reveal>
        ) : (
          <Reveal delay={0.08}>
            <ul className="space-y-4">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="bg-card border border-rule rounded-card shadow-card p-5 md:p-6 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="text-xs text-ink-faded tnum">
                      Bestellung {order.id}
                    </p>
                    <p className="text-sm font-medium text-ink">
                      {formatDate(order.createdAt)}
                    </p>
                    <p className="text-sm text-ink-aged">
                      {order.itemCount} Artikel
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span
                      className={`inline-block rounded-full border px-3 py-0.5 text-xs font-medium ${statusBadge(order.status)}`}
                    >
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                    <span className="text-xs text-ink-faded">
                      {SHIPPING_LABELS[order.shippingStatus] ?? order.shippingStatus}
                    </span>
                  </div>

                  <div className="sm:text-right space-y-1">
                    <p className="font-semibold text-ink tnum">
                      {eur(order.totalEur)}
                    </p>
                    <Link
                      href={`/konto/bestellungen/${order.id}`}
                      className="text-xs text-gold hover:underline"
                    >
                      Details ansehen<span className="sr-only"> fur Bestellung {order.id}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>
    </PageShell>
  );
}
