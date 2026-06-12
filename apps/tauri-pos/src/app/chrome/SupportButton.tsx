/**
 * SupportButton — the little life-buoy in the header that nobody really needs,
 * so tapping it just throws back a cheeky Schwäbisch one-liner instead of
 * opening a ticket. Each tap pops ONE line in place (fade + rise), it holds
 * ~3 s and floats away; tap again before it leaves and it instantly swaps to a
 * fresh one. No list, no menu — just a tiny moment of Stuttgart humour.
 *
 * (The real support code still lives here for copy-to-clipboard, so an actual
 * problem can still be reported — long-press / right-click copies it.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { IconSupport } from './Icons.js';

const SUPPORT_CODE = 'W14-963';

/** Schwäbisch (Stuagart-Eck) — affectionate, daft, never the same twice.
 *  No dots, no commas — just a quick grin. */
const SPRUECH = [
  'Dr Herrgott hot di gern',
  'Jo mei was willsch',
  'Ha no was isch jetzt',
  'Aus ond wieder eischalta',
  'Magsch mi',
  'Subr hemmrs',
  'Lass de Roman tanza 🕺',
  'Noi etz langts',
  'Hosch s scho probiert',
  'Des wird scho gell',
  'I ben koi Dokter',
  'Etz a Viertele',
  'Kehrwoch net Support',
  'Älles guad bei dir',
  'Ha noi du Schwätzer',
  'Drmit muasch leba',
  'Schaffe schaffe Häusle baua',
  'Net gschimpft isch globt gnuag',
  'Du Glomp',
  'Sell isch hald so',
  'Muggeseggele Geduld',
  'I hau ab machs guad',
  'Probier s mit Bügeln',
  'Frag de Chef ah des bisch du',
  'Heidenei scho wieder',
  'Wo bisch denn du her',
  'Bruddl net rum',
  'Geh gugg Maultäschle',
  'Etz hock di na',
  'Du bisch mr oiner',
  'Was guckscht so',
  'Hano',
  'Bisch deppert',
  'Des goht me nix a',
  'Mach hald',
  'Schwätz koi Käs',
  'Sei zfrieda',
  'Etz reichts',
  'Hosch koi Arbeit',
  'I sag nix',
  'Geduld du Hennastall',
  'Älles hot a End',
  'Wird scho werra',
  'Du Lausbua',
  'Etz no a Brezel',
  'Wo druckts denn',
  'Des kriagt mr na',
  'Halt d Luft a',
  'Pressiert s',
  'Gugg net so dapfer',
  'Bisch fertig',
  'Sodele',
  'Oh du grombiera',
  'Etz no oimol',
  'Was soll i mache',
  'Du machsch mi wahnsinnig',
] as const;

export function SupportButton(): JSX.Element {
  const [spruch, setSpruch] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const lastIdx = useRef(-1);
  const hideTimer = useRef<number | null>(null);
  const clearTimer = useRef<number | null>(null);

  const pick = useCallback((): string => {
    // never the same line twice in a row
    let i = Math.floor(Math.random() * SPRUECH.length);
    if (i === lastIdx.current) i = (i + 1) % SPRUECH.length;
    lastIdx.current = i;
    return SPRUECH[i] ?? SPRUECH[0];
  }, []);

  const fire = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    setSpruch(pick());
    setShown(true);
    // hold ~3 s, then float away…
    hideTimer.current = window.setTimeout(() => setShown(false), 3000);
    // …and unmount the text once the exit transition is done.
    clearTimer.current = window.setTimeout(() => setSpruch(null), 3320);
  }, [pick]);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  const copyCode = useCallback(() => {
    void navigator.clipboard?.writeText(`Warehouse14 POS · Support-Code: ${SUPPORT_CODE}`).catch(() => {});
  }, []);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {spruch !== null && (
        <span
          aria-live="polite"
          style={{
            position: 'absolute',
            // Anchor to the button's RIGHT edge so the bubble drops DOWN and
            // grows LEFT into the app — never off the right window edge.
            top: 'calc(100% + 8px)',
            right: 0,
            transform: `translateY(${shown ? '0' : '-8px'})`,
            transformOrigin: 'top right',
            opacity: shown ? 1 : 0,
            transition: 'opacity .3s ease, transform .3s cubic-bezier(0.16,1,0.3,1)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFamily: 'var(--w14-font-display)',
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--w14-ink)',
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-gold)',
            borderRadius: 'var(--w14-radius-card)',
            padding: '7px 14px',
            boxShadow: 'var(--w14-shadow-card)',
            zIndex: 1000,
          }}
        >
          {spruch}
        </span>
      )}
      <button
        type="button"
        onClick={fire}
        onContextMenu={(e) => {
          e.preventDefault();
          copyCode();
        }}
        title="Support"
        aria-label="Support"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          flex: '0 0 auto',
          color: 'var(--w14-ink-faded)',
          background: 'transparent',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
        }}
      >
        <IconSupport size={18} />
      </button>
    </div>
  );
}
