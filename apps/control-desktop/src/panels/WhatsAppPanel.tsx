/**
 * WhatsAppPanel — the WhatsApp-Posteingang surface for the Owner Control
 * Desktop. A master/detail inbox on top of the typed `whatsappApi` domain:
 *
 *   listThreads()  → GET   /api/whatsapp/threads         (the left rail)
 *   getThread()    → GET   /api/whatsapp/threads/:phone   (the conversation)
 *   send()         → POST  /api/whatsapp/send             (die Antwort)
 *   markHandled()  → PATCH .../messages/:id/handled       (Triage)
 *   linkCustomer() → PATCH .../messages/:id/link-customer (Kunde verknüpfen)
 *   updateAiStatus → PATCH .../threads/:phone/ai-status   (KI übernehmen)
 *
 * Every state is server-truthful. A `send` may resolve to `queued` when no
 * Meta-Zugang is configured yet — the panel says so plainly ("In
 * Warteschlange, noch nicht zugestellt") rather than faking a delivery. The
 * KI-status (`aiActive` + `cooldownUntil`) is read from the thread detail; the
 * domain has no standalone status read, so the detail carries it.
 *
 * The shared presentation helpers (Telefon-Format, Sende-Validierung, Status-
 * Labels) live in apps/mobile as `whatsapp-ui.ts`, which is not reachable from
 * this app (it depends on a mobile-only Badge type). Their pure logic + German
 * vocabulary are ported inline below, faithfully, in the desktop's formal
 * register — exactly as the tauri-pos WhatsApp screen inlines its own copy.
 */

import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  type CustomerListRow,
  type WhatsAppMessage,
  type WhatsAppOutboundStatus,
  type WhatsAppSendResponse,
  type WhatsAppThreadDetail,
  type WhatsAppThreadSummary,
  customersApi,
  whatsappApi,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

// ── Sende-Grenzen ( port of whatsapp-ui.ts) ─────────────────────────────────
// Ein freundlicher Riegel vor dem Tippen; der Server bleibt die echte Wahrheit.
const WHATSAPP_BODY_MAX = 4096;
const WHATSAPP_PHONE_MIN_DIGITS = 7;

// ── Abfragetakt ─────────────────────────────────────────────────────────────
// Ein Posteingang, der nie aktualisiert, ist kein Posteingang. Die App-weiten
// Query-Defaults schalten das Fokus-Nachladen ab (richtig für Fiskal-Lesungen,
// falsch für einen lebenden Kanal), also holt diese Fläche es zurück.
const THREADS_POLL_MS = 20_000;
const THREAD_POLL_MS = 15_000;

// ════════════════════════════════════════════════════════════════════════════
// Reine Präsentations-Helfer (ported from apps/mobile/whatsapp-ui.ts)
// ════════════════════════════════════════════════════════════════════════════

/** Kanonisiert eine Eingabe auf reine Ziffern (kein „+") — der Thread-Schlüssel. */
function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/** Anzahl der reinen Ziffern (für die Mindestlängen-Prüfung). */
function phoneDigitCount(raw: string): number {
  return normalizePhone(raw).length;
}

/**
 * Lesbare Darstellung einer gespeicherten Thread-Nummer. Stellt optisch ein
 * „+" voran und gruppiert in lockere Blöcke, ohne ein Land anzunehmen — kein
 * erfundenes Format, nur ruhige Lesbarkeit.
 */
function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 0) return phone;
  const withPlus = `+${digits}`;
  const head = withPlus.slice(0, 3);
  const rest = withPlus.slice(3);
  const grouped = rest.replace(/(\d{3,4})(?=\d)/g, '$1 ').trim();
  return grouped ? `${head} ${grouped}` : head;
}

/** Der Anzeigename eines Threads — verknüpfter Kunde, sonst die Nummer. */
function threadDisplayName(thread: WhatsAppThreadSummary): string {
  return thread.linkedCustomerName ?? formatPhone(thread.phone);
}

/** Sortiert Threads: ungelesene zuerst, dann nach letztem Zeitstempel absteigend. */
function sortThreads(threads: readonly WhatsAppThreadSummary[]): WhatsAppThreadSummary[] {
  return [...threads].sort((a, b) => {
    const aUnread = a.unreadCount > 0 ? 1 : 0;
    const bUnread = b.unreadCount > 0 ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}

interface SendValidation {
  ok: boolean;
  bodyError: string | null;
  phoneError: string | null;
}

/** Der Riegel vor dem Provider-Aufruf — eine deutsche Fehlerzeile pro Feld. */
function validateSend(args: { toPhone: string; body: string }): SendValidation {
  const body = args.body.trim();
  const phoneDigits = phoneDigitCount(args.toPhone);

  let bodyError: string | null = null;
  if (body.length === 0) {
    bodyError = 'Bitte eine Nachricht eingeben.';
  } else if (body.length > WHATSAPP_BODY_MAX) {
    bodyError = `Die Nachricht ist zu lang (max. ${WHATSAPP_BODY_MAX} Zeichen).`;
  }

  let phoneError: string | null = null;
  if (phoneDigits === 0) {
    phoneError = 'Bitte eine Telefonnummer eingeben.';
  } else if (phoneDigits < WHATSAPP_PHONE_MIN_DIGITS) {
    phoneError = 'Die Telefonnummer ist zu kurz.';
  }

  return { ok: bodyError == null && phoneError == null, bodyError, phoneError };
}

interface SendMeta {
  title: string;
  message: string;
  /** Ob die Nachricht wirklich beim Provider abgegeben wurde. */
  isLive: boolean;
}

/**
 * Die ehrliche Auslegung der Send-Antwort. `queued` heißt: gespeichert, aber
 * nichts ging raus (kein Meta-Zugang) — kein vorgetäuschtes „gesendet".
 */
function describeSend(res: WhatsAppSendResponse): SendMeta {
  if (res.status === 'queued') {
    return {
      title: 'In Warteschlange',
      message:
        'Es ist noch kein WhatsApp-Zugang hinterlegt. Die Nachricht wurde gespeichert, aber ' +
        'noch nicht zugestellt. Sobald WhatsApp verbunden ist, geht sie raus.',
      isLive: false,
    };
  }
  return {
    title: 'Nachricht gesendet',
    message: `Die Nachricht wurde an ${formatPhone(res.toPhone)} übergeben.`,
    isLive: true,
  };
}

interface AiStatusMeta {
  title: string;
  hint: string;
  toggleLabel: string;
}

/** Übersetzt den KI-Zustand in eine ruhige Zeile + ein Umschalt-Label. */
function describeAiStatus(aiActive: boolean): AiStatusMeta {
  if (aiActive) {
    return {
      title: 'KI antwortet',
      hint: 'Der Assistent beantwortet diesen Chat automatisch.',
      toggleLabel: 'Selbst übernehmen',
    };
  }
  return {
    title: 'Sie antworten',
    hint: 'Sie haben den Chat übernommen, die KI pausiert.',
    toggleLabel: 'An KI zurückgeben',
  };
}

/** Die Status-Meta einer ausgehenden Nachricht (verbatim aus whatsapp-ui.ts). */
const OUTBOUND_STATUS: Record<WhatsAppOutboundStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'In Warteschlange', tone: 'info' },
  sent: { label: 'Gesendet', tone: 'info' },
  delivered: { label: 'Zugestellt', tone: 'ok' },
  read: { label: 'Gelesen', tone: 'ok' },
  failed: { label: 'Fehlgeschlagen', tone: 'alert' },
};

/** „eben" / „vor 7 Min" / „vor 3 Std" / „vor 2 Tagen" / Datum. */
function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'eben';
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE');
}

/** „noch 11 Std 23 Min" / „noch 7 Min" — Restzeit der Übernahme-Abkühlphase. */
function formatCooldownRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `noch ${hours} Std ${minutes} Min` : `noch ${minutes} Min`;
}

// ════════════════════════════════════════════════════════════════════════════
// Styles (mirroring FinanzenPanel / ClosingsPanel)
// ════════════════════════════════════════════════════════════════════════════

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

const smallcapsLabel: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.9rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};

// ════════════════════════════════════════════════════════════════════════════
// Panel
// ════════════════════════════════════════════════════════════════════════════

export function WhatsAppPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const queryClient = useQueryClient();

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [toasts, setToasts] = useState<ToastShape[]>([]);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void => {
    setToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), tone, title, autoDismissMs: 4000, ...(body ? { body } : {}) },
    ]);
  };
  const dismissToast = (id: string): void => setToasts((prev) => prev.filter((t) => t.id !== id));

  // ── Threads (the left rail) ───────────────────────────────────────────────
  const threadsQuery = useQuery({
    queryKey: ['whatsapp', 'threads', baseUrl],
    queryFn: () => whatsappApi.listThreads(client),
    staleTime: 15_000,
    refetchInterval: THREADS_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const threads = useMemo(
    () => sortThreads(threadsQuery.data?.items ?? []),
    [threadsQuery.data],
  );
  const unreadThreads = threads.reduce((n, t) => (t.unreadCount > 0 ? n + 1 : n), 0);

  // Beim ersten Laden den obersten Thread öffnen, damit die Detailseite nicht
  // leer bleibt — nur solange der Owner noch nichts selbst gewählt hat.
  useEffect(() => {
    if (selectedPhone === null && threads.length > 0) {
      const first = threads[0];
      if (first) setSelectedPhone(first.phone);
    }
  }, [selectedPhone, threads]);

  // ── Selected conversation ─────────────────────────────────────────────────
  const detailQuery = useQuery({
    queryKey: ['whatsapp', 'thread', baseUrl, selectedPhone ?? 'none'],
    queryFn: () => whatsappApi.getThread(client, selectedPhone ?? ''),
    enabled: selectedPhone !== null,
    staleTime: 5_000,
    refetchInterval: selectedPhone !== null ? THREAD_POLL_MS : false,
    refetchOnWindowFocus: true,
  });

  const thread: WhatsAppThreadDetail | undefined = detailQuery.data;
  const messages = thread?.messages ?? [];

  // Neueste eingehende Nachricht — Ziel für „Kunde verknüpfen".
  const newestInbound = useMemo<WhatsAppMessage | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.direction === 'inbound') return m;
    }
    return null;
  }, [messages]);

  // Neueste unbearbeitete eingehende Nachricht — Ziel für „Als erledigt".
  const newestUnhandled = useMemo<WhatsAppMessage | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.direction === 'inbound' && m.handledAt === null) return m;
    }
    return null;
  }, [messages]);

  const aiActive = thread?.aiActive ?? true;
  const cooldownUntil = thread?.cooldownUntil ?? null;
  const cooldownRemainingMs = cooldownUntil ? new Date(cooldownUntil).getTime() - Date.now() : 0;
  const onCooldown = cooldownRemainingMs > 0;
  const aiMeta = describeAiStatus(aiActive);

  const invalidateWhatsApp = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['whatsapp'] });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      whatsappApi.send(client, { toPhone: selectedPhone ?? '', body }),
    onSuccess: async (res) => {
      const meta = describeSend(res);
      pushToast(meta.isLive ? 'success' : 'info', meta.title, meta.message);
      setDraft('');
      await invalidateWhatsApp();
    },
    onError: (err) => {
      pushToast(
        'alert',
        'Senden fehlgeschlagen',
        err instanceof ApiError
          ? err.code === 'EXTERNAL_SERVICE_FAILED'
            ? 'Der WhatsApp-Anbieter hat die Nachricht abgelehnt.'
            : describeError(err)
          : 'Netzwerkfehler. Bitte erneut versuchen.',
      );
    },
  });

  const markHandledMutation = useMutation({
    mutationFn: (messageId: string) => whatsappApi.markHandled(client, messageId),
    onSuccess: async () => {
      pushToast('success', 'Als erledigt markiert');
      await invalidateWhatsApp();
    },
    onError: (err) => {
      pushToast(
        'alert',
        'Konnte nicht markieren',
        err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      );
    },
  });

  const linkCustomerMutation = useMutation({
    mutationFn: (args: { messageId: string; customerId: string }) =>
      whatsappApi.linkCustomer(client, args.messageId, args.customerId),
    onSuccess: async () => {
      pushToast('success', 'Kunde verknüpft');
      await invalidateWhatsApp();
    },
    onError: (err) => {
      pushToast(
        'alert',
        'Verknüpfung fehlgeschlagen',
        err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      );
    },
  });

  const aiStatusMutation = useMutation({
    mutationFn: (next: boolean) =>
      whatsappApi.updateAiStatus(client, selectedPhone ?? '', next),
    onSuccess: async (res) => {
      pushToast(
        'success',
        res.aiActive ? 'KI antwortet wieder' : 'Sie haben übernommen',
      );
      await invalidateWhatsApp();
    },
    onError: (err) => {
      pushToast(
        'alert',
        'KI-Status fehlgeschlagen',
        err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      );
    },
  });

  const validation = validateSend({ toPhone: selectedPhone ?? '', body: draft });
  const submitDraft = (): void => {
    if (selectedPhone === null || sendMutation.isPending) return;
    const body = draft.trim();
    if (!validateSend({ toPhone: selectedPhone, body }).ok) return;
    sendMutation.mutate(body);
  };

  return (
    <>
      <DiamondRule tone="gold" label="WhatsApp" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 680 }}>
        Der WhatsApp-Posteingang. Eingehende Kundennachrichten, der Gesprächsverlauf, und die
        Antwort direkt aus dem Kontor. Der KI-Assistent beantwortet Chats automatisch, bis Sie
        selbst übernehmen.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)',
          gap: 16,
          height: 'clamp(460px, 72vh, 800px)',
          maxWidth: 1180,
        }}
      >
        {/* ── Rail: Konversationen ───────────────────────────────────────── */}
        <ParchmentCard
          tone="parchment"
          padding="none"
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '14px 16px 8px',
            }}
          >
            <span style={{ ...smallcapsLabel, fontSize: '0.74rem' }}>Konversationen</span>
            <span
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.06em',
                color: unreadThreads > 0 ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              }}
            >
              {threadsQuery.isFetching && !threadsQuery.data
                ? 'lädt …'
                : unreadThreads > 0
                  ? `${unreadThreads} offen von ${threads.length}`
                  : `${threads.length}`}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
            {threadsQuery.isLoading ? (
              <p style={{ ...captionStyle, padding: '8px 4px' }}>Lädt Konversationen …</p>
            ) : threadsQuery.isError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px' }}>
                <StatusDot tone="alert" size={10} />
                <p style={captionStyle}>Konversationen konnten nicht geladen werden.</p>
              </div>
            ) : threads.length === 0 ? (
              <EmptyThreads />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {threads.map((t) => (
                  <ThreadRow
                    key={t.phone}
                    thread={t}
                    selected={t.phone === selectedPhone}
                    onSelect={() => setSelectedPhone(t.phone)}
                  />
                ))}
              </div>
            )}
          </div>
        </ParchmentCard>

        {/* ── Detail: Konversation ───────────────────────────────────────── */}
        <ParchmentCard
          tone="parchment"
          padding="none"
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
        >
          {selectedPhone === null ? (
            <EmptyConversation />
          ) : (
            <>
              {/* Kopfzeile: Name + Nummer + KI-Status + Aktionen */}
              <div
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--w14-rule)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        fontFamily: 'var(--w14-font-display)',
                        fontWeight: 500,
                        fontSize: '1.1rem',
                        color: 'var(--w14-ink)',
                      }}
                    >
                      {thread?.linkedCustomerName ?? formatPhone(selectedPhone)}
                    </span>
                    {thread?.linkedCustomerName ? (
                      <span
                        style={{
                          fontFamily: 'var(--w14-font-mono)',
                          fontSize: '0.74rem',
                          color: 'var(--w14-ink-faded)',
                        }}
                      >
                        {formatPhone(selectedPhone)}
                      </span>
                    ) : null}
                  </div>
                  <span style={{ ...smallcapsLabel, fontSize: '0.7rem' }}>
                    {detailQuery.isFetching && !thread
                      ? 'lädt …'
                      : `${messages.length} Nachrichten`}
                  </span>
                </div>

                {/* KI-Status + Umschalten */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <StatusDot
                      tone={onCooldown ? 'watch' : aiActive ? 'ok' : 'info'}
                      size={9}
                      label={aiMeta.title}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.86rem', color: 'var(--w14-ink)' }}>
                        {aiMeta.title}
                      </span>
                      <span style={{ fontSize: '0.76rem', color: 'var(--w14-ink-faded)' }}>
                        {onCooldown
                          ? `Sie haben übernommen, ${formatCooldownRemaining(cooldownRemainingMs)}.`
                          : aiMeta.hint}
                      </span>
                    </span>
                  </span>
                  <Button
                    className="w14cd-focusable"
                    variant={aiActive ? 'ghost' : 'primary'}
                    size="sm"
                    disabled={aiStatusMutation.isPending}
                    onClick={() => aiStatusMutation.mutate(!aiActive)}
                    style={{ flex: 'none', whiteSpace: 'nowrap' }}
                  >
                    {aiStatusMutation.isPending ? '…' : aiMeta.toggleLabel}
                  </Button>
                </div>

                {/* Kunde verknüpfen + Triage */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <LinkCustomerControl
                    linkedName={thread?.linkedCustomerName ?? null}
                    target={newestInbound}
                    busy={linkCustomerMutation.isPending}
                    onPick={(customerId) => {
                      if (newestInbound) {
                        linkCustomerMutation.mutate({ messageId: newestInbound.id, customerId });
                      }
                    }}
                  />
                  <div style={{ flex: 1 }} />
                  {newestUnhandled ? (
                    <Button
                      className="w14cd-focusable"
                      variant="ghost"
                      size="sm"
                      disabled={markHandledMutation.isPending}
                      onClick={() => markHandledMutation.mutate(newestUnhandled.id)}
                      style={{ flex: 'none', whiteSpace: 'nowrap' }}
                    >
                      {markHandledMutation.isPending ? 'Markiert …' : 'Als erledigt markieren'}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* Verlauf */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {detailQuery.isLoading ? (
                  <p style={captionStyle}>Lädt Konversation …</p>
                ) : detailQuery.isError ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusDot tone="alert" size={10} />
                    <p style={captionStyle}>Konversation konnte nicht geladen werden.</p>
                  </div>
                ) : messages.length === 0 ? (
                  <p
                    style={{
                      margin: 'auto',
                      fontFamily: 'var(--w14-font-display)',
                      fontStyle: 'italic',
                      color: 'var(--w14-ink-faded)',
                      textAlign: 'center',
                    }}
                  >
                    Noch keine Nachrichten. Schreiben Sie unten Ihre Antwort.
                  </p>
                ) : (
                  messages.map((m) => <MessageBubble key={m.id} message={m} />)
                )}
              </div>

              {/* Sendebox */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitDraft();
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '12px 18px',
                  borderTop: '1px solid var(--w14-rule)',
                  background: 'var(--w14-parchment-1)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    maxLength={WHATSAPP_BODY_MAX}
                    disabled={sendMutation.isPending}
                    placeholder="Antwort schreiben …  (Enter zum Senden, Umschalt+Enter für Zeilenumbruch)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitDraft();
                      }
                    }}
                    style={{ ...inputStyle, flex: 1, minWidth: 0, resize: 'vertical', minHeight: 46 }}
                  />
                  <Button
                    className="w14cd-focusable"
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={sendMutation.isPending || !validation.ok}
                    style={{ flex: 'none', whiteSpace: 'nowrap' }}
                  >
                    {sendMutation.isPending ? 'Sendet …' : 'Senden'}
                  </Button>
                </div>
                {draft.trim().length > 0 && validation.bodyError ? (
                  <span style={{ fontSize: '0.78rem', color: 'var(--w14-wax-red)' }}>
                    {validation.bodyError}
                  </span>
                ) : null}
              </form>
            </>
          )}
        </ParchmentCard>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════════════════════

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: WhatsAppThreadSummary;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="w14cd-focusable"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        border: selected ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
        background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment)',
        borderRadius: 'var(--w14-radius-card)',
        padding: '8px 10px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontFamily: 'var(--w14-font-display)',
        color: 'var(--w14-ink)',
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: '0.92rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
            minWidth: 0,
          }}
        >
          {threadDisplayName(thread)}
        </span>
        {thread.unreadCount > 0 ? (
          <span
            aria-label={`${thread.unreadCount} ungelesen`}
            style={{
              background: 'var(--w14-gold)',
              color: 'var(--w14-ink)',
              borderRadius: 999,
              fontSize: '0.66rem',
              fontFamily: 'var(--w14-font-mono)',
              padding: '1px 6px',
              minWidth: 18,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {thread.unreadCount}
          </span>
        ) : null}
      </span>
      <span
        style={{
          fontSize: '0.78rem',
          color: 'var(--w14-ink-aged)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {thread.lastMessageDirection === 'outbound' ? '↩ ' : ''}
        {thread.lastMessagePreview}
      </span>
      <span
        style={{
          fontSize: '0.66rem',
          fontFamily: 'var(--w14-font-mono)',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {formatRelative(thread.lastMessageAt)}
      </span>
    </button>
  );
}

function MessageBubble({ message }: { message: WhatsAppMessage }): JSX.Element {
  const isInbound = message.direction === 'inbound';
  const statusMeta = !isInbound && message.status ? OUTBOUND_STATUS[message.status] : null;
  return (
    <div style={{ display: 'flex', justifyContent: isInbound ? 'flex-start' : 'flex-end' }}>
      <div
        title={new Date(message.timestamp).toLocaleString('de-DE')}
        style={{
          maxWidth: '74%',
          background: isInbound ? 'var(--w14-parchment)' : 'var(--w14-parchment-3)',
          border: `1px solid ${isInbound ? 'var(--w14-rule)' : 'var(--w14-gold)'}`,
          borderRadius: 'var(--w14-radius-card)',
          padding: '8px 12px',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.92rem',
          color: 'var(--w14-ink)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.body}
        {statusMeta ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
              fontSize: '0.68rem',
              letterSpacing: '0.04em',
              color: 'var(--w14-ink-faded)',
            }}
          >
            <StatusDot tone={statusMeta.tone} size={7} label={statusMeta.label} />
            {statusMeta.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * LinkCustomerControl — „Kunde verknüpfen". Zeigt den verknüpften Namen, sonst
 * einen Auslöser, der eine Kundensuche (customersApi.list) einblendet. Ohne
 * eingehende Nachricht gibt es kein Ziel für die PATCH-Route — dann ein
 * ehrlicher Hinweis statt eines toten Knopfs.
 */
function LinkCustomerControl({
  linkedName,
  target,
  busy,
  onPick,
}: {
  linkedName: string | null;
  target: WhatsAppMessage | null;
  busy: boolean;
  onPick: (customerId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);

  if (linkedName) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...smallcapsLabel, fontSize: '0.68rem' }}>Kunde</span>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.9rem',
            color: 'var(--w14-ink)',
          }}
        >
          {linkedName}
        </span>
        {target ? (
          <Button
            className="w14cd-focusable"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Schließen' : 'Ändern'}
          </Button>
        ) : null}
        {open && target ? (
          <CustomerPicker
            busy={busy}
            onPick={(id) => {
              onPick(id);
              setOpen(false);
            }}
          />
        ) : null}
      </span>
    );
  }

  if (!target) {
    return (
      <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
        Zum Verknüpfen muss eine eingehende Nachricht vorliegen.
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <Button
        className="w14cd-focusable"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        style={{ alignSelf: 'flex-start' }}
      >
        {open ? 'Suche schließen' : 'Kunde verknüpfen'}
      </Button>
      {open ? (
        <CustomerPicker
          busy={busy}
          onPick={(id) => {
            onPick(id);
            setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

function CustomerPicker({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (customerId: string) => void;
}): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [query, setQuery] = useState<string>('');

  const searchQuery = useQuery({
    queryKey: ['whatsapp', 'customer-search', baseUrl, query.trim()],
    queryFn: () =>
      customersApi.list(client, {
        limit: 8,
        ...(query.trim().length > 0 ? { q: query.trim() } : {}),
      }),
    staleTime: 10_000,
  });

  const items: CustomerListRow[] = searchQuery.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240, maxWidth: 320 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Kunden suchen …"
        spellCheck={false}
        disabled={busy}
        style={{ ...inputStyle, fontSize: '0.86rem', padding: '6px 8px' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
        {searchQuery.isLoading ? (
          <p style={{ ...captionStyle, fontSize: '0.78rem' }}>Sucht …</p>
        ) : items.length === 0 ? (
          <p style={{ ...captionStyle, fontSize: '0.78rem' }}>Keine Treffer.</p>
        ) : (
          items.map((c) => (
            <button
              key={c.id}
              type="button"
              className="w14cd-focusable"
              disabled={busy}
              onClick={() => onPick(c.id)}
              style={{
                textAlign: 'left',
                border: '1px solid var(--w14-rule)',
                background: 'var(--w14-parchment)',
                borderRadius: 'var(--w14-radius-card)',
                padding: '6px 8px',
                cursor: 'pointer',
                fontFamily: 'var(--w14-font-display)',
                fontSize: '0.84rem',
                color: 'var(--w14-ink)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 8,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.fullName}
              </span>
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.7rem',
                  color: 'var(--w14-ink-faded)',
                  flexShrink: 0,
                }}
              >
                {c.customerNumber}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Empty states ─────────────────────────────────────────────────────────────

function EmptyThreads(): JSX.Element {
  return (
    <div style={{ padding: '12px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot tone="info" size={10} />
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        >
          Noch keine WhatsApp-Nachrichten
        </p>
      </div>
      <p style={{ ...captionStyle, fontSize: '0.82rem' }}>
        Sobald die WhatsApp-Anbindung in den Einstellungen verbunden ist, erscheinen eingehende
        Kundennachrichten hier.
      </p>
    </div>
  );
}

function EmptyConversation(): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <DiamondRule label="WhatsApp" />
        <p
          style={{
            margin: '12px 0 0',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
          }}
        >
          Wählen Sie links eine Konversation aus, um den Verlauf zu sehen und zu antworten.
        </p>
      </div>
    </div>
  );
}
