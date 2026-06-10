// Server component: exports metadata + renders the client form island.
import type { Metadata } from "next";
import { KontaktView } from "./kontakt-view";

export const metadata: Metadata = {
  title: "Kontakt – Warehouse14",
  description:
    "Besuchen Sie uns in Schorndorf oder schreiben Sie uns. Wir freuen uns auf Ihre Nachricht.",
};

export default function KontaktPage() {
  return <KontaktView />;
}
