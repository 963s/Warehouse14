// Server component: exports metadata + renders the client booking island.
import type { Metadata } from "next";
import { TerminView } from "./termin-view";

export const metadata: Metadata = {
  title: "Termin vereinbaren – warehouse14",
  description:
    "Vereinbaren Sie online Ihren Termin in Schorndorf: Besichtigung, Goldankauf, Beratung oder Abholung. Wir bestätigen Ihren Termin persönlich.",
};

export default function TerminPage() {
  return <TerminView />;
}
