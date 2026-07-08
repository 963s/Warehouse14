/**
 * KassePurposeBanner — the plain-language intro that lands the ONE concept the
 * owner kept missing: **Tageskasse ≠ checkout.**
 *
 *   • Verkauf  = where you SELL (cart + payment, per sale).
 *   • Tageskasse = the day's cash DRAWER — a legally-required (KassenSichV)
 *     daily ritual: open the day (count the Startgeld), watch the cash flow in,
 *     close the day (count → Z-Bon).
 *
 * Purpose-clarity only — it states what the screen IS and is NOT and shows the
 * three beats of the day. No fiscal logic lives here. Stays in §10 tokens.
 */

import { ArrowDownToLine, Icon, Lock, LogIn, type LucideIcon, Wallet } from '@warehouse14/ui-kit';

const STEPS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: LogIn, title: 'Tag öffnen', body: 'Das Startgeld in der Schublade zählen.' },
  {
    icon: ArrowDownToLine,
    title: 'Bargeld im Blick',
    body: 'Jeder Barverkauf aus Verkauf landet automatisch hier.',
  },
  {
    icon: Lock,
    title: 'Tag abschließen',
    body: 'Bar zählen, dann Z-Bon, der gesetzliche Tagesabschluss.',
  },
];

export function KassePurposeBanner(): JSX.Element {
  return (
    <section
      aria-label="Was ist die Tageskasse?"
      style={{
        backgroundColor: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        boxShadow: 'var(--w14-shadow-card)',
        padding: 'var(--space-5)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-accent)',
            color: 'var(--w14-accent-ink)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon icon={Wallet} size={24} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
              lineHeight: 1.1,
            }}
          >
            Tageskasse
          </h2>
          <p
            style={{
              margin: 'var(--space-1) 0 0',
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.95rem',
              lineHeight: 1.45,
            }}
          >
            Deine Bargeld-Schublade für heute. Hier öffnest und schließt du den Kassentag und
            behältst das Bargeld im Blick.{' '}
            <strong style={{ color: 'var(--w14-ink)' }}>Verkauft wird in Verkauf</strong> (Warenkorb
            &amp; Zahlung). Die Tageskasse ist nicht der Verkauf, sondern die tägliche
            Geld-Schublade.
          </p>
        </div>
      </div>

      {/* The three beats of a cash day. */}
      <div
        style={{
          marginTop: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
              padding: 'var(--space-3)',
              background: 'var(--w14-parchment)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-button)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                color: 'var(--w14-gold)',
                display: 'grid',
                placeItems: 'center',
                paddingTop: 1,
              }}
            >
              <Icon icon={step.icon} size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                className="w14-smallcaps"
                style={{
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: '0.82rem',
                  letterSpacing: '0.06em',
                  color: 'var(--w14-ink)',
                }}
              >
                {i + 1}. {step.title}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: '0.82rem',
                  lineHeight: 1.35,
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {step.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
