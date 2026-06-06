/**
 * Steuer-Export — Tier-2 surface where the Inhaber (ADMIN) and the Steuerberater
 * (READONLY) list the daily closings and DOWNLOAD the required tax exports on
 * demand: DATEV (EXTF Buchungsstapel) + Kassenbericht (KassenSichV cash report).
 *
 * No facade: every figure + export is the REAL fiscal data from the server
 * (`GET /api/closings*`). Downloads are ADMIN/READONLY + step-up (server-
 * enforced; the api-client interceptor handles the 403 → PIN → retry). GoBD:
 * read-only — nothing here mutates a fiscal row.
 *
 * DSFinV-K (the Finanzamt cash-register standard) is delivered automatically by
 * the nightly worker push to Fiskaly — there is no manual download, so it is
 * surfaced as status, not a button. The full GDPdU/GoBD .dtd Betriebsprüfungs-
 * bundle is a separate, larger format (deferred — see the note below).
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, type ClosingListItem, closingsApi } from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  Download,
  Icon,
  MoneyAmount,
  ParchmentCard,
  Seal,
  ShieldCheck,
  TriangleAlert,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { downloadTextFile } from '../../lib/download-file.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

type ExportKind = 'datev' | 'kassenbericht';

export function SteuerExport(): JSX.Element {
  const api = useApiClient();
  const role = useSessionStore((s) => s.actor?.role);
  const addToast = useToastStore((s) => s.addToast);
  const canAccess = role === 'ADMIN' || role === 'READONLY';

  // Busy key = `${closingId}:${kind}` while a download is in flight.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const closingsQ = useQuery({
    queryKey: ['closings', 'list'],
    queryFn: () => closingsApi.list(api),
    enabled: canAccess,
    staleTime: 30_000,
  });

  const download = async (closing: ClosingListItem, kind: ExportKind): Promise<void> => {
    const key = `${closing.id}:${kind}`;
    setBusyKey(key);
    try {
      const csv =
        kind === 'datev'
          ? await closingsApi.datevCsv(api, closing.id)
          : await closingsApi.kassenberichtCsv(api, closing.id);
      const prefix = kind === 'datev' ? 'DATEV' : 'Kassenbericht';
      downloadTextFile(`${prefix}_${closing.businessDay}.csv`, csv);
      addToast({
        tone: 'success',
        title: 'Export bereit',
        body: `${prefix}_${closing.businessDay}.csv heruntergeladen.`,
      });
    } catch (err) {
      // Operator cancelled the PIN step-up → silent.
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') return;
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (!canAccess) {
    return (
      <CenterWrap>
        <ParchmentCard padding="lg" style={{ width: 'min(460px, 100%)', textAlign: 'center' }}>
          <Seal size="md" tone="faded" label="§" />
          <h2 style={{ ...HEADING, margin: '14px 0 6px' }}>Steuer-Export</h2>
          <p style={{ color: 'var(--w14-ink-faded)', margin: 0 }}>
            Nur für Inhaber und Steuerberater. Bitte mit einem berechtigten Konto anmelden.
          </p>
        </ParchmentCard>
      </CenterWrap>
    );
  }

  const items = closingsQ.data?.items ?? [];

  return (
    <section
      aria-label="Steuer-Export"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 24,
        gap: 16,
        overflowY: 'auto',
      }}
    >
      <header>
        <h1 style={HEADING}>Steuer-Export</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-aged)', fontSize: '0.95rem' }}>
          Tagesabschlüsse für Finanzamt und Steuerberater — DATEV und Kassenbericht auf Knopfdruck.
        </p>
      </header>

      <DiamondRule />

      {/* DSFinV-K + GDPdU status — not buttons, just the honest standing. */}
      <ParchmentCard padding="md" tone="deep">
        <p
          style={{ margin: 0, fontSize: '0.86rem', color: 'var(--w14-ink-aged)', lineHeight: 1.5 }}
        >
          <strong>DSFinV-K</strong> (der Finanzamt-Standard für Kassendaten) wird jede Nacht
          automatisch an Fiskaly übermittelt und dem Steuerberater bereitgestellt — kein manueller
          Download nötig. Der vollständige <strong>GDPdU/GoBD-Datenträger</strong> für eine
          Betriebsprüfung ist ein separates Format und folgt später; DSFinV-K deckt die
          Kassenpflicht ab.
        </p>
      </ParchmentCard>

      {closingsQ.isLoading ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt Abschlüsse…</p>
      ) : closingsQ.isError ? (
        <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
          Abschlüsse konnten nicht geladen werden.
        </p>
      ) : items.length === 0 ? (
        <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
            Noch keine Tagesabschlüsse vorhanden.
          </p>
        </ParchmentCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((c) => (
            <ClosingRow
              key={c.id}
              closing={c}
              busyKey={busyKey}
              onDownload={(kind) => void download(c, kind)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClosingRow({
  closing,
  busyKey,
  onDownload,
}: {
  closing: ClosingListItem;
  busyKey: string | null;
  onDownload: (kind: ExportKind) => void;
}): JSX.Element {
  const tseClean = closing.tseFailedCount === 0;
  const datevBusy = busyKey === `${closing.id}:datev`;
  const kassenBusy = busyKey === `${closing.id}:kassenbericht`;
  const anyBusy = busyKey !== null;

  return (
    <ParchmentCard padding="md">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        {/* Day + state */}
        <div style={{ minWidth: 150 }}>
          <div
            className="w14-tabular"
            style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600, fontSize: '1rem' }}
          >
            {closing.businessDay}
          </div>
          <span
            className="w14-smallcaps"
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.06em',
              color:
                closing.state === 'FINALIZED' ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
            }}
          >
            {closing.state === 'FINALIZED' ? 'abgeschlossen' : 'in Zählung'}
          </span>
        </div>

        {/* Net totals */}
        <div style={{ display: 'flex', gap: 18 }}>
          <Figure label="Verkauf netto" value={closing.netVerkaufEur} />
          <Figure label="Ankauf netto" value={closing.netAnkaufEur} />
        </div>

        {/* TSE health */}
        <div
          title={tseClean ? 'Alle Belege TSE-signiert' : `${closing.tseFailedCount} ohne Signatur`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: tseClean ? 'var(--w14-verdigris)' : 'var(--w14-wax-red)',
            fontSize: '0.8rem',
          }}
        >
          <Icon icon={tseClean ? ShieldCheck : TriangleAlert} size={18} />
          {tseClean ? 'alles signiert' : `${closing.tseFailedCount} Lücke`}
        </div>

        {/* Downloads */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="primary"
            size="md"
            iconLeft={<Icon icon={Download} size={16} />}
            disabled={anyBusy}
            onClick={() => onDownload('datev')}
            title="DATEV EXTF · Buchungsstapel"
            style={{ minHeight: 48 }}
          >
            {datevBusy ? 'lädt…' : 'DATEV'}
          </Button>
          <Button
            variant="primary"
            size="md"
            iconLeft={<Icon icon={Download} size={16} />}
            disabled={anyBusy}
            onClick={() => onDownload('kassenbericht')}
            title="Kassenbericht (KassenSichV) · CSV"
            style={{ minHeight: 48 }}
          >
            {kassenBusy ? 'lädt…' : 'Kassenbericht'}
          </Button>
        </div>
      </div>
    </ParchmentCard>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        className="w14-smallcaps"
        style={{ fontSize: '0.68rem', letterSpacing: '0.06em', color: 'var(--w14-ink-faded)' }}
      >
        {label}
      </span>
      <MoneyAmount valueEur={value} />
    </div>
  );
}

function CenterWrap({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>{children}</div>
  );
}

const HEADING = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontWeight: 500,
  fontSize: '1.6rem',
} as const;
