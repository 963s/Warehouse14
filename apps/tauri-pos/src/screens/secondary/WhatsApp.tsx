/**
 * WhatsApp — Tier-2 operator inbox (Phase 2 Day 9).
 *
 * Three-pane chat layout:
 *
 *   ┌──────────┬────────────────────────────────┬──────────────┐
 *   │ threads  │   conversation timeline        │  sidebar     │
 *   │  240 px  │   inbound left · outbound      │  300 px      │
 *   │          │   right; status + handled      │  link · mark │
 *   ├──────────┴────────────────────────────────┴──────────────┤
 *   │ composer (textarea + Senden)                              │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Optimistic send: a placeholder bubble appears immediately; on success
 * we invalidate the threads + selected-thread queries. On error we toast
 * + roll the placeholder back. The empty state nudges the operator to
 * configure the Meta webhook before the inbox sees any traffic.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  type CustomerListRow,
  type WhatsAppMessage,
  type WhatsAppOutboundStatus,
  type WhatsAppThreadDetail,
  type WhatsAppThreadSummary,
  customersApi,
  whatsappApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

// ════════════════════════════════════════════════════════════════════════
// Query keys
// ════════════════════════════════════════════════════════════════════════

const THREADS_KEY = ['whatsapp', 'threads'] as const;
const threadKey = (phone: string): readonly unknown[] => ['whatsapp', 'thread', phone];

// ════════════════════════════════════════════════════════════════════════
// Top-level screen
// ════════════════════════════════════════════════════════════════════════

export function WhatsApp(): JSX.Element {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  return (
    <section
      aria-label="WhatsApp-Inbox"
      style={{
        display: 'grid',
        gridTemplateColumns: '240px minmax(0, 1fr) 300px',
        gridTemplateRows: '1fr',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <ThreadList selectedPhone={selectedPhone} onSelect={setSelectedPhone} />
      <ConversationPane phone={selectedPhone} />
      <ThreadSidebar phone={selectedPhone} />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Pane 1 — thread list
// ════════════════════════════════════════════════════════════════════════

interface ThreadListProps {
  selectedPhone: string | null;
  onSelect: (phone: string | null) => void;
}

function ThreadList({ selectedPhone, onSelect }: ThreadListProps): JSX.Element {
  const api = useApiClient();
  const listQ = useQuery({
    queryKey: THREADS_KEY,
    queryFn: () => whatsappApi.listThreads(api),
    staleTime: 15_000,
  });

  const items = listQ.data?.items ?? [];

  return (
    <aside
      aria-label="Konversationen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 14,
        gap: 8,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.1rem',
          }}
        >
          WhatsApp
        </h2>
        <span
          className="w14-smallcaps"
          style={{
            color: 'var(--w14-ink-faded)',
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
          }}
        >
          {listQ.isFetching ? 'lädt…' : `${items.length}`}
        </span>
      </header>
      <DiamondRule />

      {listQ.isLoading ? (
        <ListSkeleton rows={6} />
      ) : listQ.isError ? (
        <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
          Konversationen konnten nicht geladen werden.
        </p>
      ) : items.length === 0 ? (
        <EmptyThreads />
      ) : (
        items.map((t) => (
          <ThreadRow
            key={t.phone}
            thread={t}
            selected={t.phone === selectedPhone}
            onClick={() => onSelect(t.phone)}
          />
        ))
      )}
    </aside>
  );
}

function ThreadRow({
  thread,
  selected,
  onClick,
}: {
  thread: WhatsAppThreadSummary;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  const displayName = thread.linkedCustomerName ?? thread.phone;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: selected ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
        background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        borderRadius: 'var(--w14-radius-card)',
        padding: '8px 10px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        outline: 'none',
        fontFamily: 'var(--w14-font-display)',
        color: 'var(--w14-ink)',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}
      >
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
          {displayName}
        </span>
        {thread.unreadCount > 0 && (
          <span
            className="w14-tabular"
            aria-label={`${thread.unreadCount} ungelesen`}
            style={{
              background: 'var(--w14-gold)',
              color: 'var(--w14-parchment)',
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
        )}
      </div>
      {thread.linkedCustomerName && (
        <span
          className="w14-tabular"
          style={{
            fontSize: '0.68rem',
            fontFamily: 'var(--w14-font-mono)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {thread.phone}
        </span>
      )}
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
        className="w14-tabular"
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

// ════════════════════════════════════════════════════════════════════════
// Pane 2 — conversation + composer
// ════════════════════════════════════════════════════════════════════════

interface OptimisticBubble {
  tempId: string;
  body: string;
  timestamp: string;
}

function ConversationPane({ phone }: { phone: string | null }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState<string>('');
  const [optimistic, setOptimistic] = useState<OptimisticBubble[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Reset draft + optimistic queue when the thread changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setState setters are stable; reset is intentionally keyed on phone only.
  useEffect(() => {
    setDraft('');
    setOptimistic([]);
  }, [phone]);

  const threadQ = useQuery({
    queryKey: phone ? threadKey(phone) : ['whatsapp', 'thread', '__none__'],
    // biome-ignore lint/style/noNonNullAssertion: query is `enabled` only when phone !== null.
    queryFn: () => whatsappApi.getThread(api, phone!),
    staleTime: 5_000,
    enabled: phone !== null,
  });

  const messages = useMemo<WhatsAppMessage[]>(() => {
    const real = threadQ.data?.messages ?? [];
    if (optimistic.length === 0) return real;
    return [
      ...real,
      ...optimistic.map((o) => ({
        id: o.tempId,
        direction: 'outbound' as const,
        body: o.body,
        timestamp: o.timestamp,
        status: 'queued' as WhatsAppOutboundStatus,
        handledAt: null,
      })),
    ];
  }, [threadQ.data, optimistic]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll intentionally fires on message count only.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = useMutation({
    // biome-ignore lint/style/noNonNullAssertion: send is only invoked from a thread with a selected phone.
    mutationFn: (body: string) => whatsappApi.send(api, { toPhone: phone!, body }),
    onMutate: (body) => {
      const tempId = `optimistic-${Date.now()}`;
      const bubble: OptimisticBubble = {
        tempId,
        body,
        timestamp: new Date().toISOString(),
      };
      setOptimistic((prev) => [...prev, bubble]);
      return { tempId };
    },
    onSuccess: async (_res, _body, ctx) => {
      if (ctx?.tempId) setOptimistic((prev) => prev.filter((o) => o.tempId !== ctx.tempId));
      setDraft('');
      await qc.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (err, _body, ctx) => {
      if (ctx?.tempId) setOptimistic((prev) => prev.filter((o) => o.tempId !== ctx.tempId));
      addToast({
        tone: 'alert',
        title: 'Senden fehlgeschlagen',
        body:
          err instanceof ApiError
            ? err.code === 'EXTERNAL_SERVICE_FAILED'
              ? 'WhatsApp-Anbieter hat abgelehnt.'
              : err.message
            : 'Netzwerkfehler. Bitte erneut versuchen.',
      });
    },
  });

  return (
    <section
      aria-label="Konversation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {phone === null ? (
        <EmptyConversation />
      ) : (
        <>
          <header
            style={{
              padding: '12px 18px',
              borderBottom: '1px solid var(--w14-rule)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--w14-font-display)',
                  fontWeight: 500,
                  fontSize: '1.1rem',
                }}
              >
                {threadQ.data?.linkedCustomerName ?? phone}
              </h2>
              {threadQ.data?.linkedCustomerName && (
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '0.72rem',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {phone}
                </span>
              )}
            </div>
            <span
              className="w14-smallcaps"
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {threadQ.isFetching ? 'lädt…' : `${messages.length} Nachrichten`}
            </span>
          </header>

          <div
            ref={scrollerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {threadQ.isLoading ? (
              <ListSkeleton rows={4} />
            ) : threadQ.isError ? (
              <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
                Konversation konnte nicht geladen werden.
              </p>
            ) : messages.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                  color: 'var(--w14-ink-faded)',
                  textAlign: 'center',
                }}
              >
                Noch keine Nachrichten — tippen Sie unten Ihre Antwort.
              </p>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            busy={send.isPending}
            onSubmit={() => {
              const body = draft.trim();
              if (body.length === 0) return;
              send.mutate(body);
            }}
          />
        </>
      )}
    </section>
  );
}

function MessageBubble({ message }: { message: WhatsAppMessage }): JSX.Element {
  const isInbound = message.direction === 'inbound';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isInbound ? 'flex-start' : 'flex-end',
      }}
    >
      <div
        title={new Date(message.timestamp).toLocaleString('de-DE')}
        style={{
          maxWidth: '72%',
          background: isInbound ? 'var(--w14-parchment-2)' : 'var(--w14-parchment-3)',
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
        {!isInbound && message.status && (
          <span
            className="w14-smallcaps"
            style={{
              display: 'block',
              marginTop: 4,
              fontSize: '0.66rem',
              letterSpacing: '0.08em',
              color:
                message.status === 'failed'
                  ? 'var(--w14-wax-red)'
                  : message.status === 'read' || message.status === 'delivered'
                    ? 'var(--w14-gold)'
                    : 'var(--w14-ink-faded)',
            }}
          >
            {statusIcon(message.status)} {STATUS_LABEL[message.status]}
          </span>
        )}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  busy,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        onSubmit();
      }}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
        padding: '12px 18px',
        borderTop: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Antwort schreiben…  (Enter zum Senden, ⇧Enter für Zeilenumbruch)"
        maxLength={4096}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          resize: 'vertical',
          padding: '8px 10px',
          border: '1px solid var(--w14-rule)',
          borderRadius: 4,
          backgroundColor: 'var(--w14-parchment)',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.92rem',
          color: 'var(--w14-ink)',
          outline: 'none',
        }}
      />
      <Button type="submit" variant="primary" disabled={busy || value.trim().length === 0}>
        {busy ? 'Sendet…' : 'Senden'}
      </Button>
    </form>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Pane 3 — thread sidebar
// ════════════════════════════════════════════════════════════════════════

function ThreadSidebar({ phone }: { phone: string | null }): JSX.Element {
  return (
    <aside
      aria-label="Thread-Details"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 14,
        borderLeft: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.05rem',
        }}
      >
        Details
      </h2>
      <DiamondRule />
      {phone === null ? (
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.88rem',
          }}
        >
          Konversation links auswählen.
        </p>
      ) : (
        <ThreadSidebarBody phone={phone} />
      )}
    </aside>
  );
}

function ThreadSidebarBody({ phone }: { phone: string }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const threadQ = useQuery({
    queryKey: threadKey(phone),
    queryFn: () => whatsappApi.getThread(api, phone),
    staleTime: 5_000,
  });

  const thread: WhatsAppThreadDetail | undefined = threadQ.data;

  // Newest unhandled inbound — the candidate for "Marker als erledigt".
  const newestUnhandled = useMemo(() => {
    if (!thread) return null;
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const m = thread.messages[i];
      if (m && m.direction === 'inbound' && m.handledAt === null) return m;
    }
    return null;
  }, [thread]);

  const markHandled = useMutation({
    mutationFn: (messageId: string) => whatsappApi.markHandled(api, messageId),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Als erledigt markiert' });
      await qc.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (err) => {
      addToast({
        tone: 'alert',
        title: 'Konnte nicht markieren',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const linkCustomer = useMutation({
    mutationFn: ({ messageId, customerId }: { messageId: string; customerId: string }) =>
      whatsappApi.linkCustomer(api, messageId, customerId),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Kunde verknüpft' });
      await qc.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (err) => {
      addToast({
        tone: 'alert',
        title: 'Verknüpfung fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const targetMessageForLink: WhatsAppMessage | null = useMemo(() => {
    if (!thread) return null;
    // Prefer the newest inbound for linking (most likely to be the operator's
    // current focus). Fall back to the very first if everything has been
    // handled already.
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const m = thread.messages[i];
      if (m && m.direction === 'inbound') return m;
    }
    return null;
  }, [thread]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ParchmentCard padding="md">
        <SidebarLabel>Telefon</SidebarLabel>
        <p
          className="w14-tabular"
          style={{
            margin: '2px 0 0',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.86rem',
            color: 'var(--w14-ink)',
          }}
        >
          {phone}
        </p>
      </ParchmentCard>

      <ParchmentCard padding="md">
        <SidebarLabel>Verknüpfter Kunde</SidebarLabel>
        {thread?.linkedCustomerName ? (
          <p
            style={{
              margin: '4px 0 0',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.95rem',
              color: 'var(--w14-ink)',
            }}
          >
            {thread.linkedCustomerName}
          </p>
        ) : (
          <p
            style={{
              margin: '4px 0 0',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
              fontSize: '0.88rem',
            }}
          >
            Noch nicht verknüpft.
          </p>
        )}
        {targetMessageForLink && (
          <CustomerPicker
            disabled={linkCustomer.isPending}
            onPick={(c) =>
              linkCustomer.mutate({
                messageId: targetMessageForLink.id,
                customerId: c.id,
              })
            }
          />
        )}
      </ParchmentCard>

      <ParchmentCard padding="md">
        <SidebarLabel>Triage</SidebarLabel>
        {newestUnhandled ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <p
              style={{
                margin: 0,
                fontSize: '0.82rem',
                color: 'var(--w14-ink-aged)',
                fontStyle: 'italic',
              }}
            >
              Letzte ungelesene Nachricht:
            </p>
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-body)',
                fontSize: '0.86rem',
                color: 'var(--w14-ink)',
                whiteSpace: 'pre-wrap',
                maxHeight: 80,
                overflowY: 'auto',
              }}
            >
              {newestUnhandled.body}
            </p>
            <Button
              variant="primary"
              disabled={markHandled.isPending}
              onClick={() => markHandled.mutate(newestUnhandled.id)}
            >
              {markHandled.isPending ? 'Markiert…' : 'Marker als erledigt'}
            </Button>
          </div>
        ) : (
          <p
            style={{
              margin: '4px 0 0',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
              fontSize: '0.88rem',
            }}
          >
            Keine offenen Nachrichten.
          </p>
        )}
      </ParchmentCard>
    </div>
  );
}

function CustomerPicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (c: CustomerListRow) => void;
}): JSX.Element {
  const api = useApiClient();
  const [query, setQuery] = useState<string>('');
  const [open, setOpen] = useState<boolean>(false);

  const searchQ = useQuery({
    queryKey: ['whatsapp', 'customer-search', query],
    queryFn: () =>
      customersApi.list(api, {
        ...(query.trim().length > 0 ? { q: query.trim() } : {}),
        limit: 8,
      }),
    enabled: open,
    staleTime: 10_000,
  });

  const items = searchQ.data?.items ?? [];

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Kunden suchen…"
        spellCheck={false}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid var(--w14-rule)',
          borderRadius: 4,
          backgroundColor: 'var(--w14-parchment)',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.86rem',
          color: 'var(--w14-ink)',
          outline: 'none',
        }}
      />
      {open && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {searchQ.isLoading ? (
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                color: 'var(--w14-ink-faded)',
                fontSize: '0.78rem',
              }}
            >
              Suche…
            </p>
          ) : items.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                color: 'var(--w14-ink-faded)',
                fontSize: '0.78rem',
              }}
            >
              Keine Treffer.
            </p>
          ) : (
            items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                  setQuery('');
                }}
                disabled={disabled}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--w14-rule)',
                  background: 'var(--w14-parchment-2)',
                  borderRadius: 'var(--w14-radius-card)',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: '0.84rem',
                  color: 'var(--w14-ink)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span>{c.fullName}</span>
                  <span
                    className="w14-tabular"
                    style={{
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: '0.7rem',
                      color: 'var(--w14-ink-faded)',
                    }}
                  >
                    {c.customerNumber}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        display: 'block',
        fontSize: '0.7rem',
        letterSpacing: '0.08em',
        color: 'var(--w14-ink-aged)',
      }}
    >
      {children}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Empty / loading states
// ════════════════════════════════════════════════════════════════════════

function EmptyThreads(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ marginTop: 8 }}>
      <DiamondRule />
      <p
        style={{
          margin: '8px 0 0',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          color: 'var(--w14-ink-faded)',
          fontSize: '0.86rem',
        }}
      >
        Noch keine WhatsApp-Nachrichten.
      </p>
      <p
        style={{
          margin: '6px 0 0',
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.78rem',
          color: 'var(--w14-ink-aged)',
        }}
      >
        Hinweis — der Meta-Webhook muss in den Einstellungen mit
        <em> WHATSAPP_VERIFY_TOKEN </em> und <em> WHATSAPP_APP_SECRET </em>
        verbunden sein, bevor eingehende Nachrichten hier erscheinen.
      </p>
    </ParchmentCard>
  );
}

function EmptyConversation(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 420 }}>
        <DiamondRule label="WhatsApp-Inbox" />
        <p
          style={{
            margin: '12px 0 0',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
          }}
        >
          Wählen Sie links eine Konversation aus,{'\n'}um den Verlauf zu sehen und zu antworten.
        </p>
      </ParchmentCard>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id.
          key={i}
          aria-hidden
          style={{
            height: 56,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.12,
          }}
        />
      ))}
      <style>
        {
          '@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }'
        }
      </style>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

const STATUS_LABEL: Record<WhatsAppOutboundStatus, string> = {
  queued: 'In Warteschlange',
  sent: 'Gesendet',
  delivered: 'Zugestellt',
  read: 'Gelesen',
  failed: 'Fehlgeschlagen',
};

function statusIcon(status: WhatsAppOutboundStatus): string {
  switch (status) {
    case 'queued':
      return '◷';
    case 'sent':
      return '✓';
    case 'delivered':
      return '✓✓';
    case 'read':
      return '✓✓';
    case 'failed':
      return '⚠';
  }
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'eben';
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE');
}
