import { PageShell } from "@/components/page-shell";
import { MerklisteClient } from "./merkliste-client";

export const metadata = {
  title: "Merkliste | warehouse14",
  description: "Ihre gespeicherten Stücke auf einen Blick.",
};

/** Server Component wrapper, keeps PageShell (with async MetalTicker) on the server. */
export default function MerklistePage() {
  return (
    <PageShell>
      <MerklisteClient />
    </PageShell>
  );
}
