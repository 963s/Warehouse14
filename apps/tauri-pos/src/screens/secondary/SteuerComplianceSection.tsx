/**
 * Steuer-Export & Compliance — die PIN-gesicherte Einstellungs-Sektion, in der
 * der Inhaber (ADMIN) bzw. der Steuerberater (READONLY) alle steuerlich
 * relevanten Exporte auf Knopfdruck zieht: DSFinV-K (Z3-Zugriff, pro
 * Kassentag), Kassenbericht (Z-Bon, CSV), DATEV (Buchungsstapel, EXTF) plus die
 * GoBD-Verfahrensdokumentation.
 *
 * Schutz: Die Sektion ist gesperrt, bis ein Manager-PIN-Step-up bestätigt ist.
 * Beim ersten Mount (und beim „Entsperren") rufen wir `GET /api/compliance/unlock`
 * — das verlangt ADMIN + frischen Step-up, also öffnet der api-client-Interceptor
 * automatisch die StepUpModal. Erst nach `{ok:true}` werden die Export-Gruppen
 * gerendert. Läuft das Step-up-Token später ab, löst auch jeder Export-Aufruf das
 * Step-up erneut aus — das ist gewollt.
 *
 * GoBD: read-only — nichts hier verändert eine fiskalische Zeile.
 */

import { useEffect, useState } from 'react';

import { ApiError, type ClosingListItem, closingsApi } from '@warehouse14/api-client';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

// Verfahrensdokumentation als Rohtext (Vite ?raw) — wird als Datei angeboten.
import verfahrensdoku from '../../../../../docs/Verfahrensdokumentation.md?raw';
import { useApiClient } from '../../lib/api-context.js';
import { downloadBase64File, downloadTextFile } from '../../lib/download-file.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

// ────────────────────────────────────────────────────────────────────────
// Datum-Helfer (lokal, ohne Zeitzonen-Drift) — YYYY-MM-DD / YYYY-MM.
// ────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function firstOfMonthIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-01`;
}

function currentMonthIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

/** Ist `businessDay` (YYYY-MM-DD) im Monat `month` (YYYY-MM)? */
function isInMonth(businessDay: string, month: string): boolean {
  return businessDay.startsWith(`${month}-`);
}

/** Ist `businessDay` (YYYY-MM-DD) im inklusiven Bereich [von, bis]? */
function isInRange(businessDay: string, von: string, bis: string): boolean {
  return businessDay >= von && businessDay <= bis;
}

const isStepUpCancel = (err: unknown): boolean =>
  err instanceof ApiError && err.code === 'STEP_UP_REQUIRED';

// ════════════════════════════════════════════════════════════════════════
// Hauptkomponente
// ════════════════════════════════════════════════════════════════════════

export function SteuerComplianceSection(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Probe gegen den Manager-PIN-Gate. Erfolg → Sektion öffnen.
  const tryUnlock = async (): Promise<void> => {
    setUnlocking(true);
    try {
      const res = await api.request<{ ok: boolean }>('GET', '/api/compliance/unlock');
      if (res?.ok === true) setUnlocked(true);
    } catch (err) {
      if (isStepUpCancel(err)) return; // Operator hat den PIN-Dialog abgebrochen → still.
      addToast({
        tone: 'alert',
        title: 'Entsperren fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setUnlocking(false);
    }
  };

  // Beim ersten Mount automatisch das Step-up anstoßen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unlock probe must fire exactly once on mount.
  useEffect(() => {
    void tryUnlock();
  }, []);

  if (!unlocked) {
    return (
      <div style={{ ...pad, placeItems: 'center', minHeight: '60vh', maxWidth: '100%' }}>
        <div style={{ ...card, maxWidth: 460, textAlign: 'center', placeItems: 'center' }}>
          <span aria-hidden="true" style={{ fontSize: '2.4rem' }}>
            🔒
          </span>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
            Geschützter Bereich
          </h2>
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: '0.9rem' }}>
            Steuer-Export &amp; Compliance ist nur mit Manager-PIN zugänglich.
          </p>
          <Button variant="primary" size="md" disabled={unlocking} onClick={() => void tryUnlock()}>
            {unlocking ? 'Prüft…' : 'Entsperren'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={pad}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Steuer-Export &amp; Compliance
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
          DATEV · DSFinV-K · TSE · GoBD. Alle Pflicht-Exporte auf Knopfdruck. Read-only, keine
          fiskalische Änderung.
        </p>
        <DiamondRule style={{ margin: '14px 0 0' }} />
      </div>

      <FinanzamtGroup api={api} addToast={addToast} />
      <KassenberichtGroup api={api} addToast={addToast} />
      <SteuerberaterGroup api={api} addToast={addToast} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 1 — Für das Finanzamt · Kassen-Nachschau
// ════════════════════════════════════════════════════════════════════════

type ApiClientLike = ReturnType<typeof useApiClient>;
type AddToast = ReturnType<typeof useToastStore.getState>['addToast'];

function FinanzamtGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const [von, setVon] = useState(firstOfMonthIso());
  const [bis, setBis] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const exportDsfinvk = async (): Promise<void> => {
    setBusy(true);
    try {
      const { items } = await closingsApi.list(api);
      const days = items
        .filter((c) => c.state === 'FINALIZED' && isInRange(c.businessDay, von, bis))
        .sort((a, b) => a.businessDay.localeCompare(b.businessDay));

      if (days.length === 0) {
        addToast({ tone: 'alert', title: 'Keine abgeschlossenen Kassentage im Zeitraum' });
        return;
      }

      let done = 0;
      for (const c of days) {
        const base64 = await closingsApi.dsfinvkZipBase64(api, c.id);
        downloadBase64File(`DSFinV-K_${c.businessDay}.zip`, base64);
        done += 1;
        addToast({
          tone: 'success',
          title: `DSFinV-K ${done}/${days.length}`,
          body: `${c.businessDay} heruntergeladen.`,
        });
      }
    } catch (err) {
      if (isStepUpCancel(err)) return;
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  const downloadVerfahrensdoku = (): void => {
    downloadTextFile(
      'Verfahrensdokumentation-Warehouse14.md',
      verfahrensdoku,
      'text/markdown;charset=utf-8',
    );
    addToast({
      tone: 'success',
      title: 'Verfahrensdokumentation',
      body: 'Verfahrensdokumentation-Warehouse14.md heruntergeladen.',
    });
  };

  return (
    <GroupCard
      title="Für das Finanzamt · Kassen-Nachschau"
      subtitle="DSFinV-K (Z3-Zugriff nach §146b AO), TSE-Archiv und die GoBD-Verfahrensdokumentation."
    >
      {/* DSFinV-K (Z3) — Von/Bis, ein ZIP je Kassentag. */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>DSFinV-K Export (Z3-Zugriff)</span>
          <span style={rowHint}>
            DSFinV-K ist tagesgenau. Pro Kassentag wird ein ZIP geladen (Prüftool-konform).
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <DateField label="Von" value={von} onChange={setVon} />
          <DateField label="Bis" value={bis} onChange={setBis} />
          <Button variant="primary" size="md" disabled={busy} onClick={() => void exportDsfinvk()}>
            {busy ? 'Lädt…' : 'DSFinV-K herunterladen'}
          </Button>
        </div>
      </div>

      {/* TSE-Archiv — ehrlicher Status, KEIN Fake-Download. */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>TSE-Archiv (TAR-Export)</span>
          <span style={rowHint}>
            Wird im nächtlichen TSE-Lauf archiviert · Abruf nach Aktivierung der TSE-Archivierung.
          </span>
        </div>
        <Button
          variant="ghost"
          size="md"
          disabled
          title="Die TSE-Archivablage ist in dieser Umgebung noch nicht eingerichtet."
        >
          Noch nicht verfügbar
        </Button>
      </div>

      {/* Verfahrensdokumentation (GoBD-Pflicht). */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>Verfahrensdokumentation herunterladen</span>
          <span style={rowHint}>GoBD-pflichtige Verfahrensdokumentation der Kasse (Markdown).</span>
        </div>
        <Button variant="ghost" size="md" onClick={downloadVerfahrensdoku}>
          Herunterladen
        </Button>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 2 — Tagesabschlüsse · Kassenbericht
// ════════════════════════════════════════════════════════════════════════

function KassenberichtGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const [tag, setTag] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const exportKassenbericht = async (): Promise<void> => {
    setBusy(true);
    try {
      const { items } = await closingsApi.list(api);
      const closing: ClosingListItem | undefined = items.find(
        (c) => c.businessDay === tag && c.state === 'FINALIZED',
      );
      if (!closing) {
        addToast({
          tone: 'alert',
          title: 'Für diesen Tag liegt kein abgeschlossener Kassenbericht vor.',
        });
        return;
      }
      const csv = await closingsApi.kassenberichtCsv(api, closing.id);
      downloadTextFile(`Kassenbericht_${closing.businessDay}.csv`, csv);
      addToast({
        tone: 'success',
        title: 'Kassenbericht',
        body: `Kassenbericht_${closing.businessDay}.csv heruntergeladen.`,
      });
    } catch (err) {
      if (isStepUpCancel(err)) return;
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GroupCard
      title="Tagesabschlüsse · Kassenbericht"
      subtitle="Der Z-Bon eines abgeschlossenen Kassentages als CSV."
    >
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>Kassenbericht (Z-Bon) herunterladen</span>
          <span style={rowHint}>Thermodruck über Tagesabschluss an der Kasse.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <DateField label="Tag" value={tag} onChange={setTag} />
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => void exportKassenbericht()}
          >
            {busy ? 'Lädt…' : 'Kassenbericht herunterladen'}
          </Button>
        </div>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 3 — Für den Steuerberater
// ════════════════════════════════════════════════════════════════════════

function SteuerberaterGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const [month, setMonth] = useState(currentMonthIso());
  const [busy, setBusy] = useState(false);

  const exportDatev = async (): Promise<void> => {
    setBusy(true);
    try {
      const { items } = await closingsApi.list(api);
      const days = items
        .filter((c) => c.state === 'FINALIZED' && isInMonth(c.businessDay, month))
        .sort((a, b) => a.businessDay.localeCompare(b.businessDay));

      if (days.length === 0) {
        addToast({ tone: 'alert', title: 'Keine abgeschlossenen Kassentage im Monat' });
        return;
      }

      let done = 0;
      for (const c of days) {
        const csv = await closingsApi.datevCsv(api, c.id);
        downloadTextFile(`DATEV_${c.businessDay}.csv`, csv);
        done += 1;
        addToast({
          tone: 'success',
          title: `DATEV ${done}/${days.length}`,
          body: `${c.businessDay} heruntergeladen.`,
        });
      }
    } catch (err) {
      if (isStepUpCancel(err)) return;
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GroupCard
      title="Für den Steuerberater"
      subtitle="Der Buchungsstapel des Monats im DATEV-EXTF-Format."
    >
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>DATEV-Export (Buchungsstapel)</span>
          <span style={rowHint}>SKR03-Buchungsstapel · EXTF. Eine CSV je Kassentag.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={fieldLabel}>Monat</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={dateInput}
            />
          </label>
          <Button variant="primary" size="md" disabled={busy} onClick={() => void exportDatev()}>
            {busy ? 'Lädt…' : 'DATEV herunterladen'}
          </Button>
        </div>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Bausteine + Styles
// ════════════════════════════════════════════════════════════════════════

function GroupCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={card}>
      <div>
        <h3
          className="w14-smallcaps"
          style={{
            margin: 0,
            fontSize: '0.78rem',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--w14-gold)',
            fontWeight: 700,
          }}
        >
          {title}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={dateInput}
      />
    </label>
  );
}

const pad: React.CSSProperties = { padding: 24, display: 'grid', gap: 18, maxWidth: 760 };
const card: React.CSSProperties = {
  background: 'var(--w14-parchment-2)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 20,
  display: 'grid',
  gap: 16,
  boxShadow: 'var(--w14-shadow-card)',
};
const rowCard: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 14,
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
};
const rowHead: React.CSSProperties = { display: 'grid', gap: 3 };
const rowTitle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
  color: 'var(--w14-ink)',
};
const rowHint: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--w14-ink-faded)' };
const fieldLabel: React.CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const dateInput: React.CSSProperties = {
  padding: '9px 11px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontSize: '0.95rem',
  fontFamily: 'var(--w14-font-mono)',
};
