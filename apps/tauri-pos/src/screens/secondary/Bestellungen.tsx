/**
 * Bestellungen, die Personal-Warteschlange der Online-Reservierungen zur
 * Abholung (0099). Bis hierher konnte niemand an der Kasse eine Web-Reservierung
 * annehmen, vorbereiten, als abholbereit melden oder übergeben; es gab nur die
 * kunden-gebundene Lesesicht in der Kundenakte. Diese Fläche schließt die Lücke.
 *
 * Das Geschäftsmodell dahinter: die Kundschaft reserviert online ein Einzelstück,
 * kommt binnen drei Tagen in den Laden, zahlt an der Kasse und nimmt es mit. Kein
 * Online-Bezahlen, kein Versand. Hier läuft der Weg vom Eingang bis zur Übergabe:
 *
 *   OFFEN            → „Annehmen"            (approve)
 *   ANGENOMMEN       → „In Vorbereitung"     (prepare)
 *   IN_VORBEREITUNG  → „Abholbereit melden"  (ready, verschickt den Brief)
 *   ABHOLBEREIT      → „Übergeben und kassieren" (lädt die Bestellung in die Kasse)
 *
 * Die Übergabe ist KEIN eigener Fiskalpfad: sie lädt die Positionen in die
 * normale Verkaufs-Karte (jede trägt die Reservierungs-Sitzung der Bestellung)
 * und läuft durch den gewöhnlichen Bezahlen-Ablauf, der den Beleg mit
 * `webOrderNumber` finalisiert. So bleiben Kassenbon und §146a-Trigger dieselben.
 *
 * Ehrlichkeits-Doktrin (wie in Anfragen): ein fehlgeschlagener Read liest sich
 * NICHT als „nichts da"; ein 409 (der Stand wurde nebenher weitergeschaltet)
 * zeigt die ehrliche deutsche Meldung über `describeError` und lädt neu; nach
 * „Abholbereit melden" wird ehrlich gesagt, ob der Brief wirklich eingereiht
 * wurde; jede Aktion trägt ihren eigenen Wartezustand, nie ein globaler Spinner.
 *
 * Knöpfe kommen aus dem geteilten Kit; Gold bleibt Faden, Kante, Siegel, nie
 * Fläche (Design-System).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';
import { type OrderView, type ProductDetail, ordersApi, productsApi } from '@warehouse14/api-client';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { useApiClient } from '../../lib/api-context.js';
import { classifyCartProductTax } from '../../lib/cart-math.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { useLedgerFeed } from '../../state/ledger-feed-store.js';

// ── Die deutschen Abholstufen (nie ein rohes Enum auf dem Schirm) ──────────────
const STAGE_LABEL: Record<string, string> = {
  OFFEN: 'Offen',
  ANGENOMMEN: 'Angenommen',
  IN_VORBEREITUNG: 'In Vorbereitung',
  ABHOLBEREIT: 'Abholbereit',
};

/** Ein unbekannter Stand degradiert zu einem deutschen Wort, nie zum rohen Token. */
function stageLabel(stage: string | null): string {
  if (!stage) return 'Unbekannter Stand';
  return STAGE_LABEL[stage] ?? 'Unbekannter Stand';
}

const BUCKETS = ['ALLE', 'OFFEN', 'ANGENOMMEN', 'IN_VORBEREITUNG', 'ABHOLBEREIT'] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketLabel(b: Bucket): string {
  return b === 'ALLE' ? 'Alle offenen' : stageLabel(b);
}

/**
 * Wie die Abholfrist gerade liest, nicht nur ein Zeitstempel. Null nur, wenn
 * gar keine Frist bekannt ist (dann wird das ehrlich gesagt, keine erfundene
 * Uhr). Läuft die Frist, wird sie ab 24 Std. ruhig-rot dringend.
 */
function deadlineLabel(expiresAt: string | null): { text: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: 'Abholfrist abgelaufen', urgent: true };
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const mins = Math.max(1, Math.round(ms / 60_000));
    return { text: `Abholung noch ${mins} Min.`, urgent: true };
  }
  if (hours <= 24) return { text: `Abholung noch ${hours} Std.`, urgent: true };
  const days = Math.round(hours / 24);
  return { text: `Abholung noch ${days} ${days === 1 ? 'Tag' : 'Tage'}`, urgent: false };
}

type StageKind = 'approve' | 'prepare' | 'ready';

export function Bestellungen(): JSX.Element {
  const api = useApiClient();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<Bucket>('ALLE');
  // Wartezustand, Fehler und Hinweis je Bestellung (nie global): eine Aktion an
  // einer Bestellung darf die Knöpfe der anderen nicht sperren.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState<Record<string, string | null>>({});

  const listQ = useCachedQuery<{ items: OrderView[] }>({
    queryKey: ['orders', 'list', bucket],
    queryFn: () => ordersApi.list(api, bucket === 'ALLE' ? undefined : bucket),
    cacheKey: `orders:list:${bucket}`,
    staleTime: 20_000,
  });

  const orders = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  // Ein Read, der nie geantwortet hat, ist keine leere Warteschlange.
  const listFailed = listQ.isError && listQ.data === undefined;

  // Live-Auffrischung: der Tagebuch-SSE-Strom trägt `web_order.*`-Ereignisse
  // (reserviert, angenommen, abgeholt …). Kommt eins herein, laden wir neu, so
  // erscheint eine frische Reservierung ohne Zutun. Ein sanfter Intervall-Takt
  // ist der Rückfall, falls der Strom gerade schweigt.
  const refetchRef = useRef(listQ.refetch);
  refetchRef.current = listQ.refetch;
  const latestWebOrderEventId = useLedgerFeed((s) => {
    const ev = s.events.find(
      (e) => typeof e.event_type === 'string' && e.event_type.startsWith('web_order.'),
    );
    return ev ? ev.id : null;
  });
  useEffect(() => {
    if (latestWebOrderEventId !== null) refetchRef.current();
  }, [latestWebOrderEventId]);
  useEffect(() => {
    const id = window.setInterval(() => refetchRef.current(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const setBusyFor = useCallback((on: string, value: boolean) => {
    setBusy((b) => ({ ...b, [on]: value }));
  }, []);

  // ── Die drei reinen Zustandsübergänge ───────────────────────────────────────
  const runTransition = useCallback(
    async (order: OrderView, kind: StageKind): Promise<void> => {
      const on = order.orderNumber;
      if (!on || busy[on]) return;
      setBusyFor(on, true);
      setErr((e) => ({ ...e, [on]: null }));
      setNote((n) => ({ ...n, [on]: null }));
      try {
        if (kind === 'approve') {
          await ordersApi.approve(api, on);
        } else if (kind === 'prepare') {
          await ordersApi.prepare(api, on);
        } else {
          const res = await ordersApi.ready(api, on);
          // Der Brief „Ihr Stück liegt bereit" ist der wichtigste Schritt. Ist er
          // NICHT eingereiht worden, wird das klar gesagt, nie so getan, als sei
          // er unterwegs.
          setNote((n) => ({
            ...n,
            [on]:
              res.mailed === false
                ? 'Als abholbereit gemeldet. Die Benachrichtigung per E-Mail wurde NICHT gesendet. Bitte die Kundschaft selbst verständigen.'
                : 'Als abholbereit gemeldet. Die Kundschaft wurde per E-Mail benachrichtigt.',
          }));
        }
        listQ.refetch();
      } catch (e) {
        // 409, wenn der Stand nebenher weitergeschaltet wurde: ehrliche deutsche
        // Meldung über describeError, nie die rohe Server-Zeichenkette, dann neu
        // laden, damit die Karte den echten Stand zeigt.
        setErr((er) => ({ ...er, [on]: describeError(e) }));
        listQ.refetch();
      } finally {
        setBusyFor(on, false);
      }
    },
    [api, busy, listQ, setBusyFor],
  );

  // ── Ablehnen: Storno mit Grund, die Stücke gehen zurück ins Regal ──────────
  //
  // Aus JEDEM laufenden Stand erlaubt, auch aus „abholbereit": fällt ein Stück
  // beim Vorbereiten als beschädigt auf, muss man absagen dürfen, statt einen
  // Menschen für nichts kommen zu lassen.
  //
  // `released` und `mailed` kommen vom SERVER. Die Kasse zählt nichts selbst
  // und behauptet nichts über einen Brief, den sie nicht geschrieben hat.
  const runReject = useCallback(
    async (order: OrderView, reason: string): Promise<void> => {
      const on = order.orderNumber;
      if (!on || busy[on]) return;
      setBusyFor(on, true);
      setErr((e) => ({ ...e, [on]: null }));
      setNote((n) => ({ ...n, [on]: null }));
      try {
        const res = await ordersApi.reject(api, on, reason.trim() || undefined);
        const stueck =
          res.released === 1 ? 'Ein Stück ist' : `${res.released} Stücke sind`;
        setNote((n) => ({
          ...n,
          [on]:
            res.mailed === false
              ? `Abgelehnt. ${stueck} wieder im Bestand. Die Absage per E-Mail wurde NICHT gesendet, bitte die Kundschaft selbst verständigen.`
              : `Abgelehnt. ${stueck} wieder im Bestand. Die Kundschaft wurde per E-Mail benachrichtigt.`,
        }));
        listQ.refetch();
      } catch (e) {
        setErr((er) => ({ ...er, [on]: describeError(e) }));
        listQ.refetch();
      } finally {
        setBusyFor(on, false);
      }
    },
    [api, busy, listQ, setBusyFor],
  );

  // ── Die Übergabe: die Bestellung in die Verkaufs-Karte laden ────────────────
  const runHandover = useCallback(
    async (order: OrderView): Promise<void> => {
      const on = order.orderNumber;
      if (!on || busy[on]) return;

      // An der Kasse liegt schon eine Karte? Sie NICHT stillschweigend ersetzen:
      // ein angefangener Verkauf hielte sonst verwaiste POS-Reservierungen, und
      // die gingen verloren. Ehrlich abbrechen, außer es ist genau diese Abholung
      // (dann ist sie schon geladen und wir wechseln nur hinüber).
      const current = useCartStore.getState();
      if (current.lines.length > 0 && current.webOrderNumber !== on) {
        setErr((er) => ({
          ...er,
          [on]:
            'An der Kasse liegt bereits eine Karte. Bitte diese zuerst abschließen oder leeren, dann die Abholung laden.',
        }));
        return;
      }

      setBusyFor(on, true);
      setErr((e) => ({ ...e, [on]: null }));
      setNote((n) => ({ ...n, [on]: null }));
      try {
        // 1. Die volle Bestellung MIT Reservierungs-Sitzung laden (nur die
        //    Detail-Abfrage liefert sie gefüllt).
        const full = await ordersApi.get(api, on);
        const sessionId = full.reservationSessionId;
        if (!sessionId) {
          setErr((er) => ({
            ...er,
            [on]:
              'Zu dieser Bestellung fehlt die Reservierungs-Sitzung. Eine Übergabe an der Kasse ist so nicht möglich.',
          }));
          return;
        }
        if (full.lines.length === 0) {
          setErr((er) => ({
            ...er,
            [on]: 'Diese Bestellung hat keine Positionen. Eine Übergabe ist nicht möglich.',
          }));
          return;
        }

        // 2. Je Position die Artikeldetails holen, Steuerklasse und
        //    Einkaufskosten (für die §25a-Marge) stecken NUR dort, nicht in der
        //    Bestellzeile. Das ist derselbe Bau wie bei einem normalen
        //    Kassenposten, nur OHNE zu reservieren: die Stücke sind schon
        //    web-gehalten, und alle tragen dieselbe Reservierungs-Sitzung.
        const cartLines: CartLine[] = [];
        for (const line of full.lines) {
          if (!line.productId) {
            setErr((er) => ({
              ...er,
              [on]: `Zu „${line.name}" fehlt die Artikel-Verknüpfung. Bitte an der Kasse einzeln erfassen.`,
            }));
            return;
          }
          // Einzelstück-Bestand: jede Position ist genau ein Stück. Eine Menge
          // über 1 kann die Kassenkarte (Einzelstücke) nicht abbilden, ehrlich
          // abbrechen, statt einen zu niedrigen Beleg zu bauen.
          if (line.quantity !== 1) {
            setErr((er) => ({
              ...er,
              [on]: `„${line.name}" hat Menge ${line.quantity}. Mengen über 1 können an der Kasse nicht als Abholung übergeben werden.`,
            }));
            return;
          }
          let detail: ProductDetail;
          try {
            detail = await productsApi.get(api, line.productId);
          } catch (e) {
            setErr((er) => ({ ...er, [on]: describeError(e) }));
            return;
          }
          const treatment = classifyCartProductTax({
            itemType: detail.itemType,
            finenessDecimal: detail.finenessDecimal,
            acquiredFromCustomerId: detail.acquiredFromCustomerId,
            isCommission: detail.isCommission,
            yearMintedFrom: detail.yearMintedFrom,
          });
          cartLines.push({
            productId: line.productId,
            reservationSessionId: sessionId,
            sku: detail.sku,
            name: detail.name,
            // Der reservierte Preis gilt: die Kundschaft zahlt, was sie online
            // reserviert hat, nicht den heutigen Listenpreis.
            listPriceEur: line.unitPriceEur,
            acquisitionCostEur: detail.acquisitionCostEur,
            taxTreatmentCode: treatment,
            addedAt: new Date().toISOString(),
          });
        }

        // 3. Alle Positionen müssen dieselbe Steuerklasse tragen, V1 signiert
        //    einen Beleg unter EINER Besteuerungsart. Sonst ehrlich abbrechen,
        //    statt einen falsch besteuerten Abhol-Beleg zu bauen.
        const first = cartLines[0]?.taxTreatmentCode;
        if (first === undefined || !cartLines.every((l) => l.taxTreatmentCode === first)) {
          setErr((er) => ({
            ...er,
            [on]:
              'Diese Bestellung mischt Steuerklassen. Ein Abhol-Beleg trägt nur eine Besteuerungsart. Bitte die Stücke einzeln an der Kasse erfassen.',
          }));
          return;
        }

        // 4. Als Karte übernehmen und zur Kasse wechseln. Dort trägt der Finalize
        //    `webOrderNumber` und schließt die Bestellung ab (CONVERTED +
        //    ABGEHOLT), im selben BEGIN wie der Beleg.
        useCartStore.getState().loadWebOrder(on, cartLines);
        navigate('/verkauf');
      } catch (e) {
        setErr((er) => ({ ...er, [on]: describeError(e) }));
      } finally {
        setBusyFor(on, false);
      }
    },
    [api, busy, navigate, setBusyFor],
  );

  return (
    <div style={{ display: 'grid', gap: '1rem', padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <ParchmentCard>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <h1 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.5rem', margin: 0 }}>
            Bestellungen
          </h1>
          <StaleBadge cachedAt={listQ.cachedAt} stale={listQ.isStale} />
        </div>
        <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.9rem', marginTop: 4 }}>
          {listFailed
            ? 'Der Stand ist gerade unbekannt.'
            : bucket === 'ALLE'
              ? orders.length > 0
                ? `${orders.length} offene ${orders.length === 1 ? 'Abholung' : 'Abholungen'}.`
                : 'Keine offene Abholung.'
              : `${orders.length} im Fach ${bucketLabel(bucket)}.`}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              style={{
                padding: '0.4rem 0.9rem',
                minHeight: 40,
                borderRadius: 999,
                // Gold ist die KANTE des gewählten Chips, nie seine Fläche.
                border: bucket === b ? '1px solid var(--w14-gilt)' : '1px solid var(--w14-rule)',
                background: bucket === b ? 'var(--w14-parchment-deep)' : 'transparent',
                color: bucket === b ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: bucket === b ? 600 : 400,
              }}
            >
              {bucketLabel(b)}
            </button>
          ))}
        </div>
      </ParchmentCard>

      <ParchmentCard>
        {listFailed ? (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.9rem', margin: 0 }}>
              Die Bestellungen konnten nicht geladen werden. Ob welche zur Abholung warten, ist
              gerade nicht bekannt.
            </p>
            <div>
              <Button variant="ghost" size="sm" onClick={() => listQ.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          </div>
        ) : listQ.isLoading && orders.length === 0 ? (
          <p style={{ color: 'var(--w14-ink-faded)' }}>Bestellungen werden geladen …</p>
        ) : orders.length === 0 ? (
          <p style={{ color: 'var(--w14-ink-faded)' }}>
            Keine Bestellungen in diesem Fach. Neue Online-Reservierungen erscheinen hier
            automatisch.
          </p>
        ) : (
          orders.map((order, i) => (
            <div key={order.id}>
              {i > 0 && <DiamondRule />}
              <OrderRow
                order={order}
                busy={order.orderNumber ? !!busy[order.orderNumber] : false}
                error={order.orderNumber ? (err[order.orderNumber] ?? null) : null}
                note={order.orderNumber ? (note[order.orderNumber] ?? null) : null}
                onTransition={runTransition}
                onHandover={runHandover}
                onReject={runReject}
              />
            </div>
          ))
        )}
      </ParchmentCard>
    </div>
  );
}

// ── Eine Bestellzeile ─────────────────────────────────────────────────────────

function OrderRow({
  order,
  busy,
  error,
  note,
  onTransition,
  onHandover,
  onReject,
}: {
  order: OrderView;
  busy: boolean;
  error: string | null;
  note: string | null;
  onTransition: (order: OrderView, kind: StageKind) => void;
  onHandover: (order: OrderView) => void;
  onReject: (order: OrderView, reason: string) => void;
}): JSX.Element {
  const deadline = deadlineLabel(order.expiresAt);
  // Zweistufig und nie aus Versehen: der erste Klick klappt das Feld für den
  // Grund auf, erst der zweite lehnt wirklich ab. Eine Ablehnung gibt Ware
  // frei und schreibt der Kundschaft, das darf kein Fehlgriff sein.
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const telHref = order.contactPhone ? `tel:${order.contactPhone.replace(/[^+\d]/g, '')}` : null;

  return (
    <div style={{ padding: '0.85rem 0', display: 'grid', gap: '0.5rem' }}>
      {/* Kopf: Bestellnummer, Stand, Frist */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.82rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {order.orderNumber ?? 'Ohne Bestellnummer'}
        </span>
        <span
          className="w14-smallcaps"
          style={{
            fontSize: '0.74rem',
            letterSpacing: '0.08em',
            color: 'var(--w14-gilt)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 999,
            padding: '1px 8px',
          }}
        >
          {stageLabel(order.pickupStage)}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.82rem',
            color: deadline
              ? deadline.urgent
                ? 'var(--w14-wax-red)'
                : 'var(--w14-gilt)'
              : 'var(--w14-ink-faded)',
          }}
        >
          {deadline ? deadline.text : 'Abholfrist unbekannt'}
        </span>
      </div>

      {/* Kundschaft: Name + antippbare Telefon-/Mail-Verknüpfung */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          fontSize: '0.9rem',
        }}
      >
        <span style={{ fontFamily: 'var(--w14-font-display)', color: 'var(--w14-ink)' }}>
          {order.contactName ?? 'Unbekannt'}
        </span>
        {telHref && (
          <a href={telHref} style={{ color: 'var(--w14-ink-faded)' }}>
            {order.contactPhone}
          </a>
        )}
        {order.contactEmail && (
          <a href={`mailto:${order.contactEmail}`} style={{ color: 'var(--w14-ink-faded)' }}>
            {order.contactEmail}
          </a>
        )}
      </div>

      {/* Die Stücke: Artikelnummer, Name, Preis */}
      <div style={{ display: 'grid', gap: 2 }}>
        {order.lines.map((line, idx) => (
          <div
            key={`${order.id}:${line.productId ?? idx}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 10,
              alignItems: 'baseline',
              fontSize: '0.86rem',
              color: 'var(--w14-ink-aged)',
            }}
          >
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.76rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {line.sku ?? 'ohne Nummer'}
            </span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {line.quantity > 1 ? `${line.quantity} × ` : ''}
              {line.name}
            </span>
            <MoneyAmount valueEur={line.unitPriceEur} />
          </div>
        ))}
      </div>

      {/* Summe + die eine Aktion, die zum Stand passt */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginTop: 2,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span
            className="w14-smallcaps"
            style={{ fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--w14-ink-faded)' }}
          >
            Gesamt
          </span>
          <MoneyAmount valueEur={order.totalEur} emphasis />
        </span>
        <StageAction order={order} busy={busy} onTransition={onTransition} onHandover={onHandover} />
      </div>

      {error && (
        <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.82rem', margin: '0.2rem 0 0' }}>
          {error}
        </p>
      )}
      {note && (
        <p style={{ color: 'var(--w14-verdigris)', fontSize: '0.82rem', margin: '0.2rem 0 0' }}>
          {note}
        </p>
      )}

      {/* Ablehnen: bewusst leise, ein Textknopf statt einer zweiten Schaltfläche,
          damit er neben dem eigentlichen Schritt nicht um Aufmerksamkeit ringt.
          Nach der Übergabe (ABGEHOLT) und nach einem Storno gibt es nichts mehr
          abzulehnen; solange ein Stand läuft, muss es gehen. */}
      {order.orderNumber && order.pickupStage !== 'ABGEHOLT' && (
        rejecting ? (
          <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.3rem' }}>
            <label
              htmlFor={`grund-${order.id}`}
              style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}
            >
              Grund, freiwillig. Er steht später im Beleg und im Tagebuch.
            </label>
            <input
              id={`grund-${order.id}`}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              maxLength={500}
              placeholder="Zum Beispiel: Stück beim Vorbereiten beschädigt"
              style={{
                font: 'inherit',
                fontSize: '0.9rem',
                padding: '0.45rem 0.6rem',
                borderRadius: 8,
                border: '1px solid var(--w14-rule)',
                background: 'var(--w14-paper-2)',
                color: 'var(--w14-ink)',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="destructive"
                size="md"
                onClick={() => onReject(order, reason)}
                disabled={busy}
              >
                {busy ? 'Wird abgelehnt …' : 'Wirklich ablehnen'}
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setRejecting(false);
                  setReason('');
                }}
                disabled={busy}
              >
                Zurück
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            style={{
              justifySelf: 'start',
              background: 'none',
              border: 'none',
              padding: '0.2rem 0',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.8rem',
              color: 'var(--w14-ink-faded)',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
            }}
          >
            Ablehnen und Stücke freigeben
          </button>
        )
      )}
    </div>
  );
}

/** Der eine Knopf für den aktuellen Stand (die Nachbarstufen zeigen keinen). */
function StageAction({
  order,
  busy,
  onTransition,
  onHandover,
}: {
  order: OrderView;
  busy: boolean;
  onTransition: (order: OrderView, kind: StageKind) => void;
  onHandover: (order: OrderView) => void;
}): JSX.Element {
  if (!order.orderNumber) {
    return (
      <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', fontStyle: 'italic' }}>
        Ohne Bestellnummer, keine Aktion möglich.
      </span>
    );
  }
  switch (order.pickupStage) {
    case 'OFFEN':
      return (
        <Button
          variant="primary"
          size="md"
          onClick={() => onTransition(order, 'approve')}
          disabled={busy}
        >
          {busy ? 'Wird angenommen …' : 'Annehmen'}
        </Button>
      );
    case 'ANGENOMMEN':
      return (
        <Button
          variant="primary"
          size="md"
          onClick={() => onTransition(order, 'prepare')}
          disabled={busy}
        >
          {busy ? 'Wird gesetzt …' : 'In Vorbereitung'}
        </Button>
      );
    case 'IN_VORBEREITUNG':
      return (
        <Button
          variant="primary"
          size="md"
          onClick={() => onTransition(order, 'ready')}
          disabled={busy}
        >
          {busy ? 'Wird gemeldet …' : 'Abholbereit melden'}
        </Button>
      );
    case 'ABHOLBEREIT':
      return (
        <Button variant="primary" size="md" onClick={() => onHandover(order)} disabled={busy}>
          {busy ? 'Wird geladen …' : 'Übergeben und kassieren'}
        </Button>
      );
    default:
      return (
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem', fontStyle: 'italic' }}>
          Kein nächster Schritt für „{stageLabel(order.pickupStage)}".
        </span>
      );
  }
}
