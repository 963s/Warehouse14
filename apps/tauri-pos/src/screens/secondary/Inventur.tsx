/**
 * Inventur — die Stichtagsinventur am Tresen (§ 240 HGB).
 *
 * Der Server konnte die körperliche Bestandsaufnahme seit Tag 21: Sitzung
 * öffnen, jede Position scannen, schließen und den Schwund rechnen. Nur konnte
 * sie niemand bedienen — vier Endpunkte ohne eine einzige Fläche. Das hier ist
 * die Fläche.
 *
 * DER FUND, DER DIESE FLÄCHE ERST BRAUCHBAR MACHT. Vor diesem Stand hätte eine
 * Inventur gelogen: die Suche lief nur über `barcode`, und auf der Live-Datenbank
 * trugen 12 von 38 zählbaren Stücken einen Barcode, aber alle 38 eine eigene SKU.
 * 26 echte, im Regal liegende Stücke wären als „unbekannt" durchgefallen und am
 * Ende als Schwund gezählt worden. Ein Schwundbericht, der zu zwei Dritteln
 * erfunden ist, ist schlimmer als gar keiner — und er ist ein Papier, das eine
 * Betriebsprüfung liest. Der Server sucht jetzt Barcode zuerst, SKU danach.
 *
 * EHRLICHKEITSREGEL DIESER FLÄCHE: „offen" ist nicht „Schwund". Solange gezählt
 * wird, ist eine nicht gefundene Position schlicht noch nicht gefunden — sie
 * liegt vielleicht in der zweiten Vitrine. Erst das Schließen macht daraus ein
 * Urteil, und genau deshalb verlangt das Schließen die Zweitbestätigung.
 *
 * Die Zahlen kommen vom Server, nicht aus einem Zähler im Fenster: ein
 * clientseitiger Zähler vergisst beim Neuladen alles und weiß nichts davon, was
 * die Kollegin an der zweiten Kasse gerade gescannt hat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';
import { inventorySessionsApi } from '@warehouse14/api-client';
import type { InventoryScanResult, InventorySessionView } from '@warehouse14/api-client';

import { useApiClient } from '../../lib/api-context.js';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner.js';
import { useSessionStore } from '../../state/session-store.js';

/** Was ein Scan bedeutet, in der Sprache des Tresens. Nie eine Rohmarke. */
const SCAN_MEANING: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  MATCHED: { label: 'Erfasst', tone: 'good' },
  DUPLICATE: { label: 'War schon erfasst', tone: 'warn' },
  UNKNOWN_BARCODE: { label: 'Kein Stück zu diesem Code', tone: 'bad' },
  EXPECTED_BUT_SOLD: { label: 'Bereits verkauft, gehört nicht ins Regal', tone: 'bad' },
  UNEXPECTED: { label: 'Entwurf, zählt noch nicht zum Bestand', tone: 'warn' },
};

function meaningOf(status: string): { label: string; tone: 'good' | 'warn' | 'bad' } {
  return SCAN_MEANING[status] ?? { label: 'Unklares Ergebnis', tone: 'warn' };
}

function toneColor(tone: 'good' | 'warn' | 'bad'): string {
  if (tone === 'good') return 'var(--w14-verdigris)';
  if (tone === 'bad') return 'var(--w14-wax-red)';
  return 'var(--w14-gilt)';
}

/** Ein Zeitpunkt so, wie ihn jemand am Tresen ausspricht. */
function clockLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ScanLine extends InventoryScanResult {
  raw: string;
  at: number;
}

const numeral: React.CSSProperties = {
  fontFamily: 'var(--w14-font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

/** Eine boxlose Kennzahl: die Ziffer groß, das Wort klein darunter. */
function Figure({
  value,
  label,
  color,
}: {
  value: number | string;
  label: string;
  color?: string | undefined;
}) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 96 }}>
      <span style={{ ...numeral, fontSize: '1.7rem', lineHeight: 1.1, color: color ?? 'var(--w14-ink)' }}>
        {value}
      </span>
      <span style={{ fontSize: '0.76rem', color: 'var(--w14-ink-faded)' }}>{label}</span>
    </div>
  );
}

export function Inventur() {
  const api = useApiClient();
  const qc = useQueryClient();
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);

  const [lines, setLines] = useState<ScanLine[]>([]);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [notes, setNotes] = useState('');
  const [closed, setClosed] = useState<InventorySessionView | null>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  const sessionQ = useQuery({
    queryKey: ['inventur', 'current'],
    queryFn: () => inventorySessionsApi.current(api),
    staleTime: 10_000,
  });
  const session = sessionQ.data ?? null;

  const progressQ = useQuery({
    queryKey: ['inventur', 'progress', session?.id ?? 'none'],
    queryFn: () => inventorySessionsApi.progress(api, session!.id),
    enabled: session != null,
    // Die zweite Kasse zählt vielleicht mit — die Zahlen dürfen nicht
    // einfrieren, nur weil an DIESEM Gerät gerade nichts gescannt wird.
    refetchInterval: session != null ? 15_000 : false,
    staleTime: 5_000,
  });
  const progress = progressQ.data ?? null;

  const record = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!session || code.length === 0 || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const res = await inventorySessionsApi.scan(api, session.id, code);
        setLines((prev) => [{ ...res, raw: code, at: Date.now() }, ...prev].slice(0, 200));
        await progressQ.refetch();
      } catch (e) {
        setErr(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [api, session, busy, progressQ],
  );

  // Der Handscanner tippt wie eine Tastatur. Solange die Sitzung läuft und der
  // Schließen-Dialog NICHT offen ist, landet jeder Scan direkt in der Zählung.
  useBarcodeScanner({
    enabled: session != null && !closing,
    onScan: (code) => void record(code),
  });

  useEffect(() => {
    if (session != null && !closing) manualRef.current?.focus();
  }, [session, closing]);

  const openSession = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await inventorySessionsApi.open(api);
      setLines([]);
      setClosed(null);
      await qc.invalidateQueries({ queryKey: ['inventur'] });
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [api, qc]);

  const closeSession = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await inventorySessionsApi.close(api, session.id, notes.trim());
      setClosed(result);
      setClosing(false);
      setNotes('');
      await qc.invalidateQueries({ queryKey: ['inventur'] });
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [api, session, notes, qc]);

  return (
    <div style={{ display: 'grid', gap: '1rem', padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <ParchmentCard>
        <h1 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.5rem', margin: 0 }}>
          Inventur
        </h1>
        <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.9rem', marginTop: 4, lineHeight: 1.6 }}>
          Die körperliche Bestandsaufnahme. Jedes Stück einmal scannen; Etikett oder
          Hersteller-Code, beides wird erkannt. Solange gezählt wird, heißt „offen" nur noch
          nicht gefunden. Erst das Schließen macht daraus Schwund.
        </p>
      </ParchmentCard>

      {err != null && (
        <ParchmentCard>
          <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.88rem', margin: 0 }}>{err}</p>
        </ParchmentCard>
      )}

      {/* ── Kein Zählgang läuft ────────────────────────────────────────────── */}
      {session == null && closed == null && (
        <ParchmentCard>
          {sessionQ.isLoading ? (
            <p style={{ color: 'var(--w14-ink-faded)' }}>Wird geprüft …</p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>Zurzeit läuft keine Inventur.</p>
              <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.85rem', marginTop: 6, lineHeight: 1.6 }}>
                {isOwner
                  ? 'Beim Öffnen hält der Server fest, wie viele Stücke der Bestand in diesem Moment führt. Es kann immer nur eine Inventur gleichzeitig laufen.'
                  : 'Eine Inventur eröffnet die Inhaberin oder der Inhaber. Sobald sie läuft, kann hier jede und jeder mitzählen.'}
              </p>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => void openSession()}
                  disabled={busy}
                  style={{
                    marginTop: '0.9rem',
                    padding: '0.5rem 1.2rem',
                    borderRadius: 8,
                    border: 0,
                    background: 'var(--w14-gilt)',
                    color: 'var(--w14-parchment)',
                    cursor: busy ? 'default' : 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  {busy ? 'Wird geöffnet …' : 'Inventur eröffnen'}
                </button>
              )}
            </>
          )}
        </ParchmentCard>
      )}

      {/* ── Der abgeschlossene Bericht ─────────────────────────────────────── */}
      {closed != null && (
        <ParchmentCard>
          <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem', margin: 0 }}>
            Inventur abgeschlossen
          </h2>
          <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', marginTop: 4 }}>
            {closed.closedAt != null ? clockLabel(closed.closedAt) : ''}
          </p>
          <DiamondRule />
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
            <Figure value={closed.expectedCount} label="Erwartet" />
            <Figure value={closed.matchedCount ?? 0} label="Gefunden" color="var(--w14-verdigris)" />
            <Figure
              value={closed.missingCount ?? 0}
              label="Schwund"
              color={(closed.missingCount ?? 0) > 0 ? 'var(--w14-wax-red)' : undefined}
            />
            <Figure value={closed.unexpectedCount ?? 0} label="Auffällige Scans" />
          </div>
          <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', marginTop: '0.9rem', lineHeight: 1.6 }}>
            Diese Zahlen stehen fest und liegen im Tagebuch. Der Schwund sind Stücke, die der
            Bestand führt und die niemand gescannt hat.
          </p>
        </ParchmentCard>
      )}

      {/* ── Der laufende Zählgang ──────────────────────────────────────────── */}
      {session != null && (
        <>
          <ParchmentCard>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem', margin: 0 }}>
                  Zählgang läuft
                </h2>
                <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', marginTop: 3 }}>
                  Eröffnet {clockLabel(session.openedAt)}
                </p>
              </div>
              {isOwner && !closing && (
                <button
                  type="button"
                  onClick={() => setClosing(true)}
                  disabled={busy}
                  style={{
                    padding: '0.45rem 1.1rem',
                    borderRadius: 8,
                    border: '1px solid var(--w14-rule)',
                    background: 'transparent',
                    color: 'var(--w14-ink-faded)',
                    cursor: 'pointer',
                    fontSize: '0.86rem',
                  }}
                >
                  Inventur abschließen
                </button>
              )}
            </div>

            <DiamondRule />

            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
              <Figure value={progress?.expectedCount ?? session.expectedCount} label="Erwartet" />
              <Figure
                value={progress?.matchedCount ?? 0}
                label="Gefunden"
                color="var(--w14-verdigris)"
              />
              <Figure
                value={progress?.openCount ?? '…'}
                label="Noch offen"
                color={(progress?.openCount ?? 0) > 0 ? 'var(--w14-gilt)' : 'var(--w14-verdigris)'}
              />
              <Figure value={progress?.scanCount ?? 0} label="Scans gesamt" />
            </div>
            <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.8rem', marginTop: '0.8rem', lineHeight: 1.6 }}>
              Die Zahlen kommen vom Server und zählen auch mit, was an einer zweiten Kasse
              gescannt wird. „Noch offen" ist noch kein Schwund.
            </p>
          </ParchmentCard>

          {/* Abschluss-Bestätigung: boxlos, mit dem, was danach feststeht. */}
          {closing && (
            <ParchmentCard>
              <h2 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.05rem', margin: 0 }}>
                Inventur wirklich abschließen?
              </h2>
              <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.86rem', marginTop: 6, lineHeight: 1.6 }}>
                {progress != null && progress.openCount > 0
                  ? `${progress.openCount} ${progress.openCount === 1 ? 'Stück ist' : 'Stücke sind'} noch nicht gefunden. Mit dem Abschluss ${progress.openCount === 1 ? 'wird daraus Schwund' : 'werden sie zu Schwund'}. Wer noch eine Vitrine offen hat, zählt besser zuerst zu Ende.`
                  : 'Alle erwarteten Stücke sind gefunden. Der Abschluss hält das fest.'}
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bemerkung zum Zählgang, etwa wer gezählt hat oder was auffiel …"
                rows={3}
                style={{
                  width: '100%',
                  marginTop: '0.7rem',
                  padding: '0.6rem',
                  borderRadius: 8,
                  border: '1px solid var(--w14-rule)',
                  background: 'var(--w14-parchment)',
                  color: 'var(--w14-ink)',
                  fontFamily: 'inherit',
                  fontSize: '0.88rem',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => void closeSession()}
                  disabled={busy}
                  style={{
                    padding: '0.45rem 1.1rem',
                    borderRadius: 8,
                    border: 0,
                    background: 'var(--w14-gilt)',
                    color: 'var(--w14-parchment)',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  {busy ? 'Wird abgeschlossen …' : 'Abschließen'}
                </button>
                <button
                  type="button"
                  onClick={() => setClosing(false)}
                  disabled={busy}
                  style={{
                    padding: '0.45rem 1.1rem',
                    borderRadius: 8,
                    border: '1px solid var(--w14-rule)',
                    background: 'transparent',
                    color: 'var(--w14-ink-faded)',
                    cursor: 'pointer',
                  }}
                >
                  Weiterzählen
                </button>
              </div>
            </ParchmentCard>
          )}

          {/* Zählfeld + der Verlauf dieses Geräts. */}
          <ParchmentCard>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = manual;
                setManual('');
                void record(code);
              }}
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
            >
              <input
                ref={manualRef}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Scannen oder Nummer eintippen"
                autoComplete="off"
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: '0.6rem 0.8rem',
                  borderRadius: 8,
                  border: '1px solid var(--w14-rule)',
                  background: 'var(--w14-parchment)',
                  color: 'var(--w14-ink)',
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.95rem',
                }}
              />
              <button
                type="submit"
                disabled={busy || manual.trim().length === 0}
                style={{
                  padding: '0.5rem 1.2rem',
                  borderRadius: 8,
                  border: 0,
                  background: manual.trim() ? 'var(--w14-gilt)' : 'var(--w14-rule)',
                  color: 'var(--w14-parchment)',
                  cursor: manual.trim() && !busy ? 'pointer' : 'default',
                }}
              >
                Erfassen
              </button>
            </form>

            <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', marginTop: '0.6rem' }}>
              Der Handscanner wird erkannt, ohne dass jemand ins Feld klicken muss.
            </p>

            {lines.length > 0 && (
              <>
                <DiamondRule />
                <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', margin: '0 0 0.3rem' }}>
                  An diesem Gerät zuletzt erfasst. Der vollständige Zählgang liegt beim Server.
                </p>
                {lines.map((line, i) => {
                  const meaning = meaningOf(line.matchStatus);
                  return (
                    <div key={line.id}>
                      {i > 0 && <DiamondRule />}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '0.75rem',
                          padding: '0.5rem 0',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ ...numeral, fontSize: '0.85rem' }}>{line.sku ?? line.raw}</span>
                        <span style={{ color: toneColor(meaning.tone), fontSize: '0.85rem', flex: 1 }}>
                          {meaning.label}
                        </span>
                        <span style={{ ...numeral, fontSize: '0.75rem', color: 'var(--w14-ink-faded)' }}>
                          {new Date(line.at).toLocaleTimeString('de-DE', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </ParchmentCard>
        </>
      )}
    </div>
  );
}
