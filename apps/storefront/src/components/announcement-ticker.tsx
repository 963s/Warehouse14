const points = [
  "Versicherter Versand ab 100 €",
  "Live-Edelmetallkurse in Echtzeit",
  "GoBD- & GwG-konform",
  "Goldankauf zu fairen Tagespreisen",
  "Jedes Stück geprüft & zertifiziert",
  "Sichere Zahlung · Stripe & Vorkasse",
];

export function AnnouncementTicker() {
  // CSS-only marquee (no JS), duplicated track for a seamless loop.
  const track = [...points, ...points];
  return (
    <div role="marquee" aria-label="Ankündigungen" className="border-b border-white/10 bg-[#101318] text-white/85">
      <div className="marquee-mask mx-auto flex max-w-edge overflow-hidden py-2">
        <ul className="flex shrink-0 animate-marquee items-center gap-8 whitespace-nowrap pr-8 text-[0.72rem] font-medium tracking-wide">
          {track.map((p, i) => (
            <li key={i} aria-hidden={i >= points.length ? "true" : undefined} className="flex items-center gap-8">
              <span>{p}</span>
              <span className="h-1 w-1 rounded-full bg-gold" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
