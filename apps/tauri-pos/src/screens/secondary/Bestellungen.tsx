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

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, DiamondRule, MoneyAmount } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';
import { type OrderView, type ProductDetail, ordersApi, productsApi } from '@warehouse14/api-client';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { useApiClient } from '../../lib/api-context.js';
import { classifyCartProductTax } from '../../lib/cart-math.js';
import { type ShopInfoApi, resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import { fehlendeAngaben, versandmarkeHtml } from '../../lib/versandmarke.js';
import { fehltFuerRechnung, rechnungHtml } from '../../lib/rechnung.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { useLedgerFeed } from '../../state/ledger-feed-store.js';

// ── Die deutschen Abholstufen (nie ein rohes Enum auf dem Schirm) ──────────────
const STAGE_LABEL: Record<string, string> = {
  OFFEN: 'Offen',
  ANGENOMMEN: 'Angenommen',
  IN_VORBEREITUNG: 'In Vorbereitung',
  ABHOLBEREIT: 'Abholbereit',
};

/**
 * Die Marke drucken. Öffnet ein eigenes, leeres Fenster mit NUR dem Aufkleber,
 * damit weder die Kassenfläche noch ihre Bildschirmfarben mit auf das Papier
 * geraten.
 *
 * Gibt eine deutsche Meldung zurück, wenn es nicht ging, sonst null. Ein
 * blockierter Fensteröffner ist der häufigste Grund, und ein Klick, der
 * scheinbar nichts tut, ist schlimmer als ein Satz, der sagt warum.
 */
function markeDrucken(order: OrderView, shopApi: ShopInfoApi | undefined): string | null {
  const nummer = order.orderNumber?.trim();
  if (!nummer) return 'Ohne Bestellnummer lässt sich keine Marke drucken.';

  const versand = order.fulfilmentMethod === 'SHIPPING';
  const bestellung = {
    bestellnummer: nummer,
    versandart: versand ? ('SHIPPING' as const) : ('PICKUP' as const),
    empfaenger: order.contactName,
    lieferanschrift: order.shippingAddress,
    land: order.shippingCountry,
    stueckzahl: order.itemCount,
    bestelltAm: new Date(order.createdAt).toLocaleDateString('de-DE'),
  };

  const fehlt = fehlendeAngaben(bestellung);
  if (fehlt.length > 0) return fehlt.join(' ');

  // Die ECHTEN Ladendaten, wenn sie geladen sind; sonst der eingebaute
  // Rückfall. Beides ist eine wahre Anschrift, keine erfundene.
  const shop = resolveShopInfo(shopApi);
  const html = versandmarkeHtml({ name: shop.name, anschrift: shop.address }, bestellung);

  const fenster = window.open('', '_blank', 'width=420,height=620');
  if (!fenster) {
    return 'Das Druckfenster wurde blockiert. Bitte Fenster für diese App erlauben.';
  }
  fenster.document.write(html);
  fenster.document.close();
  // Erst drucken, wenn das Fenster fertig ist: sonst druckt Safari eine leere
  // Seite, und die fällt erst am Drucker auf.
  fenster.onload = () => {
    fenster.focus();
    fenster.print();
  };
  return null;
}

/**
 * Die VORLÄUFIGE Rechnung drucken. Wie die Marke: eigenes leeres Fenster, damit
 * die Bildschirmfarben nicht mit aufs Papier geraten. Basels Wunsch: dem Kunden
 * auch ohne TSE eine Rechnung geben können. Das Dokument sagt selbst gross, dass
 * es kein steuerlicher Beleg ist (rechnung.ts).
 */
function rechnungDrucken(order: OrderView, shopApi: ShopInfoApi | undefined): string | null {
  const fehlt = fehltFuerRechnung(order);
  if (fehlt.length > 0) return fehlt.join(' ');
  const shop = resolveShopInfo(shopApi);
  const html = rechnungHtml({ name: shop.name, anschrift: shop.address }, order);
  const fenster = window.open('', '_blank', 'width=560,height=760');
  if (!fenster) {
    return 'Das Druckfenster wurde blockiert. Bitte Fenster für diese App erlauben.';
  }
  fenster.document.write(html);
  fenster.document.close();
  fenster.onload = () => {
    fenster.focus();
    fenster.print();
  };
  return null;
}

/** Ein unbekannter Stand degradiert zu einem deutschen Wort, nie zum rohen Token. */
function stageLabel(stage: string | null): string {
  if (!stage) return 'Unbekannter Stand';
  return STAGE_LABEL[stage] ?? 'Unbekannter Stand';
}

/** Die Reihenfolge der Stufen — für den Fortschrittsbalken im Detail. */
const STAGE_ORDER = ['OFFEN', 'ANGENOMMEN', 'IN_VORBEREITUNG', 'ABHOLBEREIT'] as const;

/**
 * Woher kam die Bestellung (0105). Ein ruhiges Abzeichen, Gold nur als Kante.
 * „App" fürs Handy, „Webshop" fürs Browserfenster — der Tresen sieht das Gesicht
 * der Bestellung auf einen Blick.
 */
function OriginBadge({ origin }: { origin: string }): JSX.Element {
  const istApp = origin === 'APP';
  return (
    <span
      className="w14-smallcaps"
      title={istApp ? 'Aus der Handy-App des Kunden' : 'Aus dem Webshop (Browser)'}
      style={{
        fontSize: '0.68rem',
        letterSpacing: '0.08em',
        color: 'var(--w14-ink-faded)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 999,
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {istApp ? 'App' : 'Webshop'}
    </span>
  );
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
  // Welche Bestellung im rechten Bereich offen liegt (Meister-Detail). Null =
  // noch keine gewählt; dann wählt der Effekt unten die erste.
  const [selected, setSelected] = useState<string | null>(null);

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

  /**
   * Eine EINZELNE Position herausnehmen. Der Fall, der vorher die ganze
   * Bestellung kostete: eines von drei Stücken ist beim Vorbereiten beschädigt,
   * die anderen zwei liegen tadellos im Regal.
   *
   * Bewusst mit Rückfrage: das Stück geht sofort zurück in den Verkauf und die
   * Kundschaft bekommt einen Brief. Das ist kein Fehlgriff-Klick.
   */
  const runRemoveItem = useCallback(
    async (order: OrderView, productId: string, name: string): Promise<void> => {
      const on = order.orderNumber;
      if (!on || busy[on]) return;
      if (
        !window.confirm(
          `„${name}" aus der Bestellung nehmen?\n\n` +
            'Das Stück geht sofort zurück in den Verkauf, und die Kundschaft ' +
            'bekommt eine E-Mail über die Änderung.',
        )
      ) {
        return;
      }
      setBusyFor(on, true);
      setErr((e) => ({ ...e, [on]: null }));
      setNote((n) => ({ ...n, [on]: null }));
      try {
        const res = await ordersApi.removeItem(api, on, productId);
        const rest =
          res.remaining === 1 ? 'Ein Stück bleibt' : `${res.remaining} Stücke bleiben`;
        setNote((n) => ({
          ...n,
          [on]: res.mailed
            ? `„${name}" herausgenommen und wieder im Bestand. ${rest} reserviert. Die Kundschaft wurde benachrichtigt.`
            : `„${name}" herausgenommen und wieder im Bestand. ${rest} reserviert. Die E-Mail wurde NICHT gesendet, bitte selbst verständigen.`,
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

  /** Die Abholfrist verlängern, wenn jemand anruft und später kommen will. */
  const runExtend = useCallback(
    async (order: OrderView, days: number): Promise<void> => {
      const on = order.orderNumber;
      if (!on || busy[on]) return;
      setBusyFor(on, true);
      setErr((e) => ({ ...e, [on]: null }));
      setNote((n) => ({ ...n, [on]: null }));
      try {
        const res = await ordersApi.extend(api, on, days);
        const datum = new Date(res.newDeadline).toLocaleDateString('de-DE', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
        });
        setNote((n) => ({
          ...n,
          [on]: res.mailed
            ? `Frist verlängert bis ${datum}. Die Kundschaft hat das neue Datum per E-Mail.`
            : `Frist verlängert bis ${datum}. Die E-Mail wurde NICHT gesendet, bitte selbst verständigen.`,
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

  // Die gewaehlte Bestellung aus der Liste (das Listen-Query traegt die
  // Positionen schon mit, das Detail braucht also keinen zweiten Abruf). Faellt
  // die Wahl aus dem Fach, rueckt die erste nach.
  const selectedOrder = useMemo(
    () => orders.find((o) => o.orderNumber === selected) ?? null,
    [orders, selected],
  );
  useEffect(() => {
    if (orders.length === 0) return;
    if (!selectedOrder) setSelected(orders[0]?.orderNumber ?? null);
  }, [orders, selectedOrder]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Kopfleiste: Titel, Zahl, Faecher — volle Breite, kein zentrierter Kasten */}
      <header
        style={{ padding: '0.9rem 1.1rem 0.7rem', borderBottom: '1px solid var(--w14-rule)' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.9rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.4rem', margin: 0 }}>
            Bestellungen
          </h1>
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>
            {listFailed
              ? 'Stand gerade unbekannt'
              : bucket === 'ALLE'
                ? orders.length > 0
                  ? `${orders.length} offene ${orders.length === 1 ? 'Abholung' : 'Abholungen'}`
                  : 'Keine offene Abholung'
                : `${orders.length} im Fach ${bucketLabel(bucket)}`}
          </span>
          <span style={{ flex: 1 }} />
          <StaleBadge cachedAt={listQ.cachedAt} stale={listQ.isStale} />
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              style={{
                padding: '0.35rem 0.85rem',
                minHeight: 36,
                borderRadius: 999,
                // Gold ist die KANTE des gewaehlten Chips, nie seine Flaeche.
                border: bucket === b ? '1px solid var(--w14-gilt)' : '1px solid var(--w14-rule)',
                background: bucket === b ? 'var(--w14-parchment-deep)' : 'transparent',
                color: bucket === b ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: bucket === b ? 600 : 400,
              }}
            >
              {bucketLabel(b)}
            </button>
          ))}
        </div>
      </header>

      {/* Der Arbeitsplatz: links die Warteschlange, rechts die offene Bestellung.
          Voll hoch, voll breit — kein 1100px-Kasten mehr, der in der Mitte
          schwebt. Das war Basels Befund: „مزروعة بل منتصف مزعج". */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 0.85fr) minmax(0, 1.5fr)',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Linke Schiene: die scrollbare Warteschlange */}
        <aside
          style={{ overflowY: 'auto', borderRight: '1px solid var(--w14-rule)', minHeight: 0 }}
        >
          {listFailed ? (
            <div style={{ padding: '1rem', display: 'grid', gap: '0.6rem' }}>
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
            <p style={{ padding: '1rem', color: 'var(--w14-ink-faded)' }}>
              Bestellungen werden geladen …
            </p>
          ) : orders.length === 0 ? (
            <p style={{ padding: '1rem', color: 'var(--w14-ink-faded)' }}>
              Keine Bestellungen in diesem Fach. Neue Online-Reservierungen erscheinen hier
              automatisch.
            </p>
          ) : (
            orders.map((order) => (
              <OrderListRow
                key={order.id}
                order={order}
                selected={order.orderNumber === selected}
                busy={order.orderNumber ? !!busy[order.orderNumber] : false}
                onSelect={() => setSelected(order.orderNumber ?? null)}
              />
            ))
          )}
        </aside>

        {/* Rechter Bereich: die offene Bestellung, voll und mit Tiefe */}
        <main style={{ overflowY: 'auto', minHeight: 0 }}>
          {selectedOrder ? (
            <OrderDetail
              order={selectedOrder}
              busy={selectedOrder.orderNumber ? !!busy[selectedOrder.orderNumber] : false}
              error={
                selectedOrder.orderNumber ? (err[selectedOrder.orderNumber] ?? null) : null
              }
              note={selectedOrder.orderNumber ? (note[selectedOrder.orderNumber] ?? null) : null}
              onTransition={runTransition}
              onHandover={runHandover}
              onReject={runReject}
              onRemoveItem={runRemoveItem}
              onExtend={runExtend}
            />
          ) : (
            <div
              style={{
                padding: '2.5rem 1.5rem',
                color: 'var(--w14-ink-faded)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1rem' }}>
                Wählen Sie links eine Bestellung, um sie zu bearbeiten.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** Gemeinsamer Stil fuer die leisen Text-Knoepfe (Drucken, Ablehnen). */
const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: '0.84rem',
  color: 'var(--w14-ink-faded)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
};

// ── Eine Zeile in der linken Warteschlange ───────────────────────────────────

function OrderListRow({
  order,
  selected,
  busy,
  onSelect,
}: {
  order: OrderView;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}): JSX.Element {
  const deadline = deadlineLabel(order.expiresAt);
  const versand = order.fulfilmentMethod === 'SHIPPING';
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        padding: '0.7rem 0.9rem',
        border: 'none',
        // Gold als schmale Kante des gewaehlten Eintrags, nie als Flaeche.
        borderLeft: selected ? '3px solid var(--w14-gilt)' : '3px solid transparent',
        borderBottom: '1px solid var(--w14-rule)',
        background: selected ? 'var(--w14-parchment-deep)' : 'transparent',
        font: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.78rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {order.orderNumber ?? 'ohne Nummer'}
        </span>
        <span style={{ flex: 1 }} />
        <OriginBadge origin={order.orderOrigin} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {order.contactName ?? 'Unbekannt'}
        </span>
        <span style={{ flex: 1 }} />
        <MoneyAmount valueEur={order.totalEur} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: 4 }}>
        <span
          className="w14-smallcaps"
          style={{
            fontSize: '0.68rem',
            letterSpacing: '0.06em',
            color: 'var(--w14-gilt)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 999,
            padding: '1px 7px',
          }}
        >
          {versand ? 'Versand' : stageLabel(order.pickupStage)}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: '0.76rem',
            color: deadline
              ? deadline.urgent
                ? 'var(--w14-wax-red)'
                : 'var(--w14-ink-faded)'
              : 'var(--w14-ink-faded)',
          }}
        >
          {deadline ? deadline.text : 'Frist unbekannt'}
        </span>
      </div>
      {busy && (
        <span style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>
          … wird bearbeitet
        </span>
      )}
    </button>
  );
}

// ── Der Fortschrittsbalken der Abholstufen ───────────────────────────────────

function StageStepper({ current }: { current: string | null }): JSX.Element {
  const idx = STAGE_ORDER.indexOf((current ?? '') as (typeof STAGE_ORDER)[number]);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginTop: '0.2rem' }}>
      {STAGE_ORDER.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const active = i === idx;
        return (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: i < STAGE_ORDER.length - 1 ? 1 : 'none',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  border: active
                    ? '2px solid var(--w14-gilt)'
                    : done
                      ? '2px solid var(--w14-verdigris)'
                      : '2px solid var(--w14-rule)',
                  background: done
                    ? 'var(--w14-verdigris)'
                    : active
                      ? 'var(--w14-gilt)'
                      : 'transparent',
                }}
              />
              <span
                className="w14-smallcaps"
                style={{
                  fontSize: '0.62rem',
                  letterSpacing: '0.04em',
                  color: active ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                  whiteSpace: 'nowrap',
                }}
              >
                {stageLabel(s)}
              </span>
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  margin: '7px 6px 0',
                  background: done ? 'var(--w14-verdigris)' : 'var(--w14-rule)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Der rechte Bereich: die offene Bestellung, voll und mit Tiefe ────────────

function OrderDetail({
  order,
  busy,
  error,
  note,
  onTransition,
  onHandover,
  onReject,
  onRemoveItem,
  onExtend,
}: {
  order: OrderView;
  busy: boolean;
  error: string | null;
  note: string | null;
  onTransition: (order: OrderView, kind: StageKind) => void;
  onHandover: (order: OrderView) => void;
  onReject: (order: OrderView, reason: string) => void;
  onRemoveItem: (order: OrderView, productId: string, name: string) => void;
  onExtend: (order: OrderView, days: number) => void;
}): JSX.Element {
  const deadline = deadlineLabel(order.expiresAt);
  const versand = order.fulfilmentMethod === 'SHIPPING';
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [druckFehler, setDruckFehler] = useState<string | null>(null);
  const { data: shopApi } = useShopInfo();
  const telHref = order.contactPhone ? `tel:${order.contactPhone.replace(/[^+\d]/g, '')}` : null;
  // Wechselt die Bestellung, den lokalen Zustand zuruecksetzen — sonst haengt
  // ein aufgeklapptes Grund-Feld an der falschen Bestellung.
  useEffect(() => {
    setRejecting(false);
    setReason('');
    setDruckFehler(null);
  }, [order.orderNumber]);

  return (
    <div style={{ padding: '1.1rem 1.3rem', display: 'grid', gap: '0.9rem', maxWidth: 760 }}>
      {/* Kopf: Nummer, Herkunft, Stand, Frist, dann der Fortschrittsbalken */}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span
            className="w14-tabular"
            style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '1rem', color: 'var(--w14-ink)' }}
          >
            {order.orderNumber ?? 'Ohne Bestellnummer'}
          </span>
          <OriginBadge origin={order.orderOrigin} />
          <span
            className="w14-smallcaps"
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              color: 'var(--w14-gilt)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 999,
              padding: '1px 8px',
            }}
          >
            {versand ? 'Versand' : stageLabel(order.pickupStage)}
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.85rem',
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
        {!versand && <StageStepper current={order.pickupStage} />}
      </div>

      {/* Kundschaft: Name + antippbare Verknuepfungen, bei Versand die Anschrift */}
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <span
          style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.05rem', color: 'var(--w14-ink)' }}
        >
          {order.contactName ?? 'Unbekannt'}
        </span>
        <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.88rem' }}>
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
        {versand && order.shippingAddress && (
          <p
            style={{
              margin: '0.2rem 0 0',
              fontSize: '0.85rem',
              color: 'var(--w14-ink-aged)',
              whiteSpace: 'pre-line',
            }}
          >
            {order.shippingAddress}
          </p>
        )}
      </div>

      <DiamondRule />

      {/* Die Stuecke */}
      <div style={{ display: 'grid', gap: 8 }}>
        {order.lines.map((line, idx) => (
          <div
            key={`${order.id}:${line.productId ?? idx}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 12,
              alignItems: 'baseline',
              fontSize: '0.92rem',
              color: 'var(--w14-ink-aged)',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {line.quantity > 1 ? `${line.quantity} × ` : ''}
                {line.name}
              </span>
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.72rem',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {line.sku ?? 'ohne Nummer'}
              </span>
            </span>
            <MoneyAmount valueEur={line.unitPriceEur} />
            {order.lines.length > 1 && line.productId && onRemoveItem ? (
              <button
                type="button"
                title="Diese Position herausnehmen und das Stück freigeben"
                aria-label={`${line.name} herausnehmen`}
                onClick={() => onRemoveItem(order, line.productId as string, line.name)}
                disabled={busy}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0 2px',
                  cursor: busy ? 'default' : 'pointer',
                  color: 'var(--w14-ink-faded)',
                  fontSize: '1.05rem',
                  lineHeight: 1,
                  opacity: busy ? 0.4 : 1,
                }}
              >
                ×
              </button>
            ) : (
              <span />
            )}
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
          borderTop: '1px solid var(--w14-rule)',
          paddingTop: '0.7rem',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span
            className="w14-smallcaps"
            style={{ fontSize: '0.72rem', letterSpacing: '0.1em', color: 'var(--w14-ink-faded)' }}
          >
            Gesamt
          </span>
          <MoneyAmount valueEur={order.totalEur} emphasis />
        </span>
        <StageAction order={order} busy={busy} onTransition={onTransition} onHandover={onHandover} />
      </div>

      {error && (
        <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.85rem', margin: 0 }}>{error}</p>
      )}
      {note && (
        <p style={{ color: 'var(--w14-verdigris)', fontSize: '0.85rem', margin: 0 }}>{note}</p>
      )}

      {/* Mehr Zeit geben */}
      {order.orderNumber && order.pickupStage !== 'ABGEHOLT' && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.84rem', color: 'var(--w14-ink-faded)' }}>Mehr Zeit geben:</span>
          {[3, 7, 14].map((tage) => (
            <button
              key={tage}
              type="button"
              onClick={() => onExtend(order, tage)}
              disabled={busy}
              style={{
                background: 'none',
                border: '1px solid var(--w14-rule)',
                borderRadius: 999,
                padding: '2px 10px',
                font: 'inherit',
                fontSize: '0.82rem',
                color: 'var(--w14-ink-aged)',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {tage} Tage
            </button>
          ))}
        </div>
      )}

      {/* Drucken: der Regalzettel/die Versandmarke, und die VORLAEUFIGE Rechnung.
          Letztere ist Basels Wunsch: dem Kunden auch ohne TSE eine Rechnung
          geben, freiwillig. Das Dokument sagt selbst gross, dass es kein
          steuerlicher Beleg ist. */}
      {order.orderNumber && (
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <button
            type="button"
            onClick={() => setDruckFehler(markeDrucken(order, shopApi))}
            style={linkBtn}
          >
            {order.fulfilmentMethod === 'SHIPPING' ? 'Versandmarke drucken' : 'Regalzettel drucken'}
          </button>
          <button
            type="button"
            onClick={() => setDruckFehler(rechnungDrucken(order, shopApi))}
            style={linkBtn}
          >
            Vorläufige Rechnung drucken
          </button>
        </div>
      )}
      {druckFehler && (
        <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.82rem', margin: 0 }}>{druckFehler}</p>
      )}

      {/* Ablehnen: zweistufig, bewusst leise */}
      {order.orderNumber &&
        order.pickupStage !== 'ABGEHOLT' &&
        (rejecting ? (
          <div
            style={{
              display: 'grid',
              gap: '0.5rem',
              borderTop: '1px solid var(--w14-rule)',
              paddingTop: '0.7rem',
            }}
          >
            <label
              htmlFor={`grund-${order.id}`}
              style={{ fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}
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
                padding: '0.5rem 0.65rem',
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
            style={{ ...linkBtn, justifySelf: 'start' }}
          >
            Ablehnen und Stücke freigeben
          </button>
        ))}
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
