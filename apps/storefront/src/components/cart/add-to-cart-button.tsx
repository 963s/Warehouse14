"use client";

import { useState } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { useCart } from "./cart-provider";
import { cn } from "@/lib/cn";
import type { ProductSummary } from "@/lib/storefront-data";

type Props = {
  product: Pick<ProductSummary, "id" | "name" | "slug" | "sku" | "primaryImage" | "listPriceEur">;
  full?: boolean;
  label?: string;
};

export function AddToCartButton({ product, full = false, label = "Warenkorb" }: Props) {
  const { add } = useCart();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === "loading") return;
    setState("loading");
    try {
      await add(product);
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  }

  const srLabel = state === "done" ? "Hinzugefügt" : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "loading"}
      aria-label={!full ? srLabel : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-button bg-ink text-sm font-medium text-white ring-1 ring-inset ring-transparent transition-[background-color,box-shadow,opacity] hover:bg-ink-aged hover:ring-gold/40 disabled:opacity-70",
        full ? "w-full px-6 py-3.5 text-base" : "px-3.5 py-2",
      )}
    >
      {state === "loading" ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      ) : state === "done" ? (
        <Check aria-hidden="true" className="h-4 w-4" />
      ) : (
        <Plus aria-hidden="true" className="h-4 w-4" />
      )}
      {full ? (
        <span>{state === "done" ? "Hinzugefügt" : label}</span>
      ) : (
        <>
          <span aria-hidden="true" className="hidden xl:inline">{state === "done" ? "Hinzugefügt" : label}</span>
          <span className="sr-only">{srLabel}</span>
        </>
      )}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {state === "loading" ? "Wird hinzugefügt" : state === "done" ? "Hinzugefügt" : ""}
      </span>
    </button>
  );
}
