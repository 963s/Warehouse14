/**
 * PrintPreview — the honest, on-screen preview of exactly what a share/print
 * will produce. A native RN render (NOT a WebView of the HTML — no new dep) that
 * mirrors the printed layout: a Bon-shaped receipt card, or a grid of label
 * cards. Every figure is a real value from the `ReceiptDoc` / `LabelDoc` the
 * caller built; nothing is fabricated. Built on the shared theme + Money helper.
 *
 * It is intentionally read-only and self-contained: the surface composes it
 * above the action buttons, and the same doc is handed to `printPrintable` /
 * `sharePdfPrintable`, so what the owner sees is byte-for-byte what prints.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Money } from "@warehouse14/domain/money"

import { Text } from "@/components/ui/text"

import type { LabelDoc, Printable, ReceiptDoc } from "./types"

function eur(value: string): string {
  return Money.of(value, "EUR").format()
}

function dateTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function MonoRow({
  label,
  value,
  muted = false,
  bold = false,
}: {
  label: string
  value: string
  muted?: boolean
  bold?: boolean
}): ReactNode {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className={bold ? "flex-1 text-sm font-semibold" : muted ? "text-muted-foreground flex-1 text-xs" : "flex-1 text-sm"}>
        {label}
      </Text>
      <Text className={bold ? "font-mono-medium text-sm" : muted ? "text-muted-foreground font-mono text-xs" : "font-mono text-sm"}>
        {value}
      </Text>
    </View>
  )
}

function ReceiptCard({ doc }: { doc: ReceiptDoc }): ReactNode {
  const totalCaption = doc.kind === "Ankauf" ? "Auszahlung gesamt" : "Gesamt"
  const stamp = doc.receiptLocator ? `Beleg-Nr. ${doc.receiptLocator}` : `${doc.kind} · Vorschau`
  return (
    <View className="rounded-xl border border-border bg-card p-4 gap-3">
      <View className="items-center gap-0.5">
        {doc.shopName ? <Text className="text-base font-semibold">{doc.shopName}</Text> : null}
        <Text className="text-muted-foreground text-xs">{stamp}</Text>
        <Text className="text-muted-foreground font-mono text-2xs">{dateTime(doc.issuedAt)}</Text>
      </View>

      <View className="h-px bg-border" />

      <View className="gap-1.5">
        {doc.lines.map((l, i) => (
          <View key={`${l.sku ?? l.name}-${i}`} className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm" numberOfLines={1}>
                {l.qty && l.qty > 1 ? `${l.qty}× ` : ""}
                {l.name}
              </Text>
              {l.sku ? (
                <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                  {l.sku}
                </Text>
              ) : null}
            </View>
            <Text className="font-mono text-sm">{eur(l.totalEur)}</Text>
          </View>
        ))}
      </View>

      <View className="h-px bg-border" />

      <View className="gap-1">
        {doc.subtotalEur ? (
          <MonoRow label="Zwischensumme (netto)" value={eur(doc.subtotalEur)} muted />
        ) : null}
        {(doc.vatRows ?? []).map((v, i) => (
          <MonoRow key={`${v.label}-${i}`} label={v.label} value={eur(v.vatEur)} muted />
        ))}
        <View className="my-0.5 h-px bg-border" />
        <MonoRow label={totalCaption} value={eur(doc.totalEur)} bold />
      </View>

      {doc.payment ? (
        <>
          <View className="h-px bg-border" />
          <View className="gap-1">
            <MonoRow label="Zahlungsart" value={doc.payment.methodLabel} muted />
            {doc.payment.receivedEur ? (
              <MonoRow label="Erhalten" value={eur(doc.payment.receivedEur)} muted />
            ) : null}
            {doc.payment.changeEur ? (
              <MonoRow label="Rückgeld" value={eur(doc.payment.changeEur)} muted />
            ) : null}
          </View>
        </>
      ) : null}

      {doc.belegtext ? (
        <>
          <View className="h-px bg-border" />
          <Text className="text-muted-foreground text-2xs leading-4">{doc.belegtext}</Text>
        </>
      ) : null}
    </View>
  )
}

function LabelCard({ doc }: { doc: LabelDoc }): ReactNode {
  return (
    <View className="rounded-xl border border-border bg-card p-3.5 gap-1">
      <Text className="text-sm font-semibold" numberOfLines={2}>
        {doc.name}
      </Text>
      {doc.note ? (
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          {doc.note}
        </Text>
      ) : null}
      <Text className="font-mono-medium text-lg">{eur(doc.priceEur)}</Text>
      <Text className="text-muted-foreground font-mono text-2xs">Art-Nr. {doc.sku}</Text>
      {doc.barcode ? (
        <Text className="text-muted-foreground font-mono text-2xs tracking-widest">{doc.barcode}</Text>
      ) : null}
      {doc.location ? (
        <Text className="text-muted-foreground font-mono text-2xs">{doc.location}</Text>
      ) : null}
    </View>
  )
}

export interface PrintPreviewProps {
  printable: Printable
}

/** The on-screen preview for any printable: a Bon receipt or a label grid. */
export function PrintPreview({ printable }: PrintPreviewProps): ReactNode {
  if (printable.type === "receipt") return <ReceiptCard doc={printable.doc} />
  return (
    <View className="gap-2.5">
      {printable.docs.map((d, i) => (
        <LabelCard key={`${d.sku}-${i}`} doc={d} />
      ))}
    </View>
  )
}
