/**
 * UpdateCenter — the ONE update surface.
 *
 * A parchment Dialog driven entirely by `useAppUpdate`. Replaces the native
 * (unstyled) Tauri prompt, the auto-installing header ↻, and the floating
 * UpdateBanner with a single, deliberate German flow:
 *
 *   up-to-date  → "Sie verwenden die neueste Version (vX.Y.Z)"
 *   available   → "Neue Version X verfügbar" + Notes + [Jetzt aktualisieren]/[Später]
 *   downloading → a DETERMINATE bar  "Wird heruntergeladen… NN %"
 *   ready       → "Update bereit"   + [Jetzt neu starten]
 *   error       → the message + [Erneut prüfen]
 *
 * The restart is ALWAYS a deliberate button — never an auto-timeout. Before an
 * install or relaunch we guard against data loss: if the Verkauf cart or the
 * Ankauf intake cart holds an in-progress sale, the operator must explicitly
 * confirm ("Offenen Verkauf zuerst abschließen?") before we proceed.
 */

import { type CSSProperties, useState } from 'react';

import { Button, Dialog, DialogBody, DialogFooter } from '@warehouse14/ui-kit';

import { useAppUpdate } from '../../hooks/useAppUpdate.js';
import { useAnkaufCartStore } from '../../state/ankauf-cart-store.js';
import { useCartStore } from '../../state/cart-store.js';
import { IconCheck, IconRefresh } from './Icons.js';

export interface UpdateCenterProps {
  open: boolean;
  onClose: () => void;
}

const SMALLCAPS_LABEL: CSSProperties = {
  letterSpacing: '0.08em',
  fontSize: '0.74rem',
  color: 'var(--w14-ink-aged)',
  fontWeight: 600,
};

const NOTES_STYLE: CSSProperties = {
  marginTop: 12,
  padding: '12px 14px',
  background: 'var(--w14-parchment)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card, 6px)',
  fontSize: '0.85rem',
  lineHeight: 1.5,
  color: 'var(--w14-ink-faded)',
  whiteSpace: 'pre-wrap',
  maxHeight: 200,
  overflowY: 'auto',
};

export function UpdateCenter({ open, onClose }: UpdateCenterProps): JSX.Element {
  const { status, currentVersion, version, notes, progressPct, error, checkNow, install, relaunch } =
    useAppUpdate();

  // Open-sale guard: only the COUNT matters here, so subscribe narrowly.
  const verkaufCount = useCartStore((s) => s.lines.length);
  const ankaufCount = useAnkaufCartStore((s) => s.items.length);
  const hasOpenSale = verkaufCount > 0 || ankaufCount > 0;

  // The confirm gate the operator must pass when a sale is in progress.
  const [confirmingDespiteSale, setConfirmingDespiteSale] = useState(false);

  const guarded = (proceed: () => void): void => {
    if (hasOpenSale && !confirmingDespiteSale) {
      setConfirmingDespiteSale(true);
      return;
    }
    setConfirmingDespiteSale(false);
    proceed();
  };

  const onInstall = (): void => guarded(() => void install());
  const onRelaunch = (): void => guarded(() => void relaunch());

  return (
    <Dialog open={open} onClose={onClose} title="Aktualisierungen" size="sm">
      <DialogBody>
        {confirmingDespiteSale ? (
          <OpenSaleWarning />
        ) : (
          <>
            {(status === 'idle' || status === 'checking') && (
              <StatusRow
                icon={<IconRefresh size={18} />}
                spinning={status === 'checking'}
                title={status === 'checking' ? 'Suche nach Updates…' : 'Bereit zur Prüfung'}
                body={
                  status === 'checking'
                    ? 'Der Update-Kanal wird abgefragt.'
                    : `Aktuelle Version: v${currentVersion}`
                }
              />
            )}

            {status === 'up-to-date' && (
              <StatusRow
                icon={<IconCheck size={18} />}
                tone="ok"
                title="Alles aktuell"
                body={`Sie verwenden die neueste Version (v${currentVersion}).`}
              />
            )}

            {status === 'available' && (
              <>
                <StatusRow
                  icon={<span aria-hidden>✦</span>}
                  tone="gold"
                  title={`Neue Version ${version} verfügbar`}
                  body={`Installierte Version: v${currentVersion}.`}
                />
                {notes && <div style={NOTES_STYLE}>{notes}</div>}
              </>
            )}

            {status === 'downloading' && (
              <DownloadProgress pct={progressPct ?? 0} version={version} />
            )}

            {status === 'ready' && (
              <StatusRow
                icon={<IconCheck size={18} />}
                tone="gold"
                title="Update bereit"
                body={`Version ${version ?? ''} wurde geladen. Die App startet beim Neustart in der neuen Version.`}
              />
            )}

            {status === 'error' && (
              <StatusRow
                icon={<span aria-hidden>!</span>}
                tone="alert"
                title="Update-Prüfung fehlgeschlagen"
                body={error ?? 'Bitte später erneut versuchen.'}
              />
            )}
          </>
        )}
      </DialogBody>

      <DialogFooter>
        {confirmingDespiteSale ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmingDespiteSale(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                status === 'ready' ? guarded(() => void relaunch()) : guarded(() => void install())
              }
            >
              Trotzdem fortfahren
            </Button>
          </>
        ) : (
          <FooterActions
            status={status}
            onClose={onClose}
            onCheck={() => void checkNow()}
            onInstall={onInstall}
            onRelaunch={onRelaunch}
          />
        )}
      </DialogFooter>
    </Dialog>
  );
}

// ── Footer action sets per state ───────────────────────────────────────────

function FooterActions({
  status,
  onClose,
  onCheck,
  onInstall,
  onRelaunch,
}: {
  status: ReturnType<typeof useAppUpdate>['status'];
  onClose: () => void;
  onCheck: () => void;
  onInstall: () => void;
  onRelaunch: () => void;
}): JSX.Element {
  if (status === 'available') {
    return (
      <>
        <Button variant="ghost" onClick={onClose}>
          Später
        </Button>
        <Button variant="primary" onClick={onInstall}>
          Jetzt aktualisieren
        </Button>
      </>
    );
  }
  if (status === 'downloading') {
    return (
      <Button variant="ghost" disabled>
        Wird heruntergeladen…
      </Button>
    );
  }
  if (status === 'ready') {
    return (
      <>
        <Button variant="ghost" onClick={onClose}>
          Später
        </Button>
        <Button variant="primary" onClick={onRelaunch}>
          Jetzt neu starten
        </Button>
      </>
    );
  }
  // idle | checking | up-to-date | error
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Schließen
      </Button>
      <Button variant="primary" onClick={onCheck} disabled={status === 'checking'}>
        {status === 'error' ? 'Erneut prüfen' : 'Nach Updates suchen'}
      </Button>
    </>
  );
}

// ── Presentational helpers ─────────────────────────────────────────────────

const SPIN_KEYFRAMES = '@keyframes w14UpdateSpin { to { transform: rotate(360deg); } }';

function StatusRow({
  icon,
  title,
  body,
  spinning = false,
  tone = 'neutral',
}: {
  icon: JSX.Element;
  title: string;
  body: string;
  spinning?: boolean;
  tone?: 'neutral' | 'ok' | 'gold' | 'alert';
}): JSX.Element {
  const iconColor =
    tone === 'gold'
      ? 'var(--w14-gold)'
      : tone === 'ok'
        ? 'var(--w14-accent, var(--w14-gold))'
        : tone === 'alert'
          ? 'var(--w14-danger)'
          : 'var(--w14-ink-faded)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <style>{SPIN_KEYFRAMES}</style>
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          flex: '0 0 auto',
          marginTop: 1,
          color: iconColor,
          ...(spinning ? { animation: 'w14UpdateSpin 0.9s linear infinite' } : {}),
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="w14-smallcaps" style={SMALLCAPS_LABEL}>
          {title}
        </div>
        <div style={{ marginTop: 4, fontSize: '0.9rem', color: 'var(--w14-ink)', lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function DownloadProgress({ pct, version }: { pct: number; version: string | null }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div>
      <div className="w14-smallcaps" style={SMALLCAPS_LABEL}>
        {version ? `Version ${version}` : 'Aktualisierung'} — wird heruntergeladen… {clamped} %
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Update-Download-Fortschritt"
        style={{
          marginTop: 10,
          height: 10,
          width: '100%',
          background: 'var(--w14-parchment)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: 'var(--w14-accent)',
            transition: 'width var(--w14-dur-short, 150ms) linear',
          }}
        />
      </div>
      <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
        Bitte nicht schließen — die App startet danach neu.
      </div>
    </div>
  );
}

function OpenSaleWarning(): JSX.Element {
  return (
    <StatusRow
      icon={<span aria-hidden>!</span>}
      tone="alert"
      title="Offener Verkauf"
      body="Eine Aktualisierung erfordert einen Neustart. Offenen Verkauf zuerst abschließen? Nicht abgeschlossene Positionen gehen beim Neustart verloren."
    />
  );
}
