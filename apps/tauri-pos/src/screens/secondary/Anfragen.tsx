/**
 * Anfragen — customer support tickets at the counter (0097).
 *
 * The shop's mail was outbound only until now: a customer who replied to a
 * reservation letter was writing into a mailbox last opened four weeks ago.
 * The server side collects those replies into tickets; this is where somebody
 * finally reads and answers them.
 *
 * The queue is sorted by who spoke last, not by age. A ticket where the
 * customer is still waiting outranks a newer one that has already had a
 * reply, because an unanswered question is the only thing here that is
 * actively costing goodwill.
 */

import { useCallback, useMemo, useState } from 'react';

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { supportApi } from '@warehouse14/api-client';
import type { SupportTicketDetail, TicketStatus } from '@warehouse14/api-client';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { useApiClient } from '../../lib/api-context.js';

const STATUS_LABEL: Record<string, string> = {
  OFFEN: 'Offen',
  WARTET: 'Wartet auf Kundin oder Kunde',
  GESCHLOSSEN: 'Geschlossen',
};

/** German for a moment in time, said the way somebody at a counter says it. */
function whenLabel(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60_000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  if (mins < 24 * 60) return `vor ${Math.round(mins / 60)} Std.`;
  return then.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
}

export function Anfragen() {
  const api = useApiClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bucket, setBucket] = useState<TicketStatus | 'ALLE'>('ALLE');

  const listQ = useCachedQuery({
    queryKey: ['support', 'tickets', bucket],
    queryFn: () => supportApi.list(api, bucket === 'ALLE' ? undefined : bucket),
    cacheKey: `support:tickets:${bucket}`,
    staleTime: 20_000,
  });

  const detailQ = useCachedQuery<SupportTicketDetail | null>({
    queryKey: ['support', 'ticket', openId ?? 'none'],
    queryFn: () => (openId ? supportApi.get(api, openId) : Promise.resolve(null)),
    cacheKey: `support:ticket:${openId ?? 'none'}`,
    staleTime: 10_000,
  });

  const tickets = useMemo(() => listQ.data ?? [], [listQ.data]);
  const waiting = tickets.filter((t) => t.awaitingReply).length;
  const detail = openId ? detailQ.data : null;

  const send = useCallback(async () => {
    if (!openId || !draft.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await supportApi.reply(api, openId, draft.trim());
      setDraft('');
      setNote(`Antwort zu ${res.ticketNumber} ist in der Warteschlange.`);
      listQ.refetch();
      detailQ.refetch();
    } catch (e) {
      // The reply is queued, not sent inline, so the only honest thing to
      // report is whether it was ACCEPTED. Claiming "sent" here would be a
      // guess about a worker tick that has not happened yet.
      setErr(e instanceof Error ? e.message : 'Die Antwort konnte nicht übernommen werden.');
    } finally {
      setBusy(false);
    }
  }, [api, openId, draft, busy, listQ, detailQ]);

  const setStatus = useCallback(
    async (status: TicketStatus) => {
      if (!openId || busy) return;
      setBusy(true);
      try {
        await supportApi.setStatus(api, openId, status);
        listQ.refetch();
        detailQ.refetch();
      } finally {
        setBusy(false);
      }
    },
    [api, openId, busy, listQ, detailQ],
  );

  return (
    <div style={{ display: 'grid', gap: '1rem', padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <ParchmentCard>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
          <h1 style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.5rem', margin: 0 }}>
            Anfragen
          </h1>
          <StaleBadge cachedAt={listQ.cachedAt} stale={listQ.isStale} />
        </div>
        <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.9rem', marginTop: 4 }}>
          {waiting > 0
            ? `${waiting} ${waiting === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf eine Antwort.`
            : 'Keine Anfrage wartet auf eine Antwort.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {(['ALLE', 'OFFEN', 'WARTET', 'GESCHLOSSEN'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              style={{
                padding: '0.35rem 0.8rem',
                borderRadius: 999,
                border: '1px solid var(--w14-rule)',
                background: bucket === b ? 'var(--w14-gilt)' : 'transparent',
                color: bucket === b ? 'var(--w14-parchment)' : 'var(--w14-ink-faded)',
                cursor: 'pointer',
                fontSize: '0.82rem',
              }}
            >
              {b === 'ALLE' ? 'Alle offenen' : STATUS_LABEL[b]}
            </button>
          ))}
        </div>
      </ParchmentCard>

      <ParchmentCard>
        {listQ.isLoading && tickets.length === 0 ? (
          <p style={{ color: 'var(--w14-ink-faded)' }}>Anfragen werden geladen …</p>
        ) : tickets.length === 0 ? (
          <p style={{ color: 'var(--w14-ink-faded)' }}>
            Keine Anfragen. Antworten von Kundinnen und Kunden erscheinen hier automatisch.
          </p>
        ) : (
          tickets.map((t, i) => (
            <div key={t.id}>
              {i > 0 && <DiamondRule />}
              <button
                type="button"
                onClick={() => {
                  setOpenId(openId === t.id ? null : t.id);
                  setErr(null);
                  setNote(null);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 0,
                  padding: '0.7rem 0',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span
                    className="w14-tabular"
                    style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}
                  >
                    {t.ticketNumber}
                  </span>
                  <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.98rem', flex: 1 }}>
                    {t.subject}
                  </span>
                  {t.awaitingReply && (
                    <span style={{ color: 'var(--w14-wax-red)', fontSize: '0.8rem' }}>wartet</span>
                  )}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                  {t.customerName ?? 'Unbekannt'}
                  {t.customerNumber ? ` · ${t.customerNumber}` : ''}
                  {' · '}
                  {STATUS_LABEL[t.status] ?? t.status}
                  {t.lastInboundAt ? ` · ${whenLabel(t.lastInboundAt)}` : ''}
                </div>
              </button>

              {openId === t.id && (
                <div style={{ paddingBottom: '0.75rem' }}>
                  {detailQ.isLoading && !detail ? (
                    <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>Wird geladen …</p>
                  ) : (
                    <>
                      {(detail?.messages ?? []).map((m) => (
                        <div
                          key={m.id}
                          style={{
                            margin: '0.5rem 0',
                            padding: '0.6rem 0.8rem',
                            borderRadius: 8,
                            background:
                              m.direction === 'INBOUND' ? 'var(--w14-parchment-deep)' : 'transparent',
                            border:
                              m.direction === 'INBOUND' ? 0 : '1px solid var(--w14-rule)',
                          }}
                        >
                          <div style={{ fontSize: '0.75rem', color: 'var(--w14-ink-faded)' }}>
                            {m.direction === 'INBOUND' ? m.from : 'Warehouse 14'}
                            {' · '}
                            {whenLabel(m.createdAt)}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', marginTop: 3 }}>
                            {m.body}
                          </div>
                        </div>
                      ))}

                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Antwort schreiben …"
                        rows={4}
                        style={{
                          width: '100%',
                          marginTop: '0.5rem',
                          padding: '0.6rem',
                          borderRadius: 8,
                          border: '1px solid var(--w14-rule)',
                          background: 'var(--w14-parchment)',
                          color: 'var(--w14-ink)',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          resize: 'vertical',
                        }}
                      />
                      {err && (
                        <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.82rem', margin: '0.4rem 0 0' }}>
                          {err}
                        </p>
                      )}
                      {note && (
                        <p style={{ color: 'var(--w14-gilt)', fontSize: '0.82rem', margin: '0.4rem 0 0' }}>
                          {note}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={send}
                          disabled={busy || draft.trim().length === 0}
                          style={{
                            padding: '0.45rem 1.1rem',
                            borderRadius: 8,
                            border: 0,
                            background: draft.trim() ? 'var(--w14-gilt)' : 'var(--w14-rule)',
                            color: 'var(--w14-parchment)',
                            cursor: draft.trim() && !busy ? 'pointer' : 'default',
                          }}
                        >
                          {busy ? 'Wird übernommen …' : 'Antwort senden'}
                        </button>
                        {t.status !== 'GESCHLOSSEN' ? (
                          <button
                            type="button"
                            onClick={() => setStatus('GESCHLOSSEN')}
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
                            Schließen
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setStatus('OFFEN')}
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
                            Wieder öffnen
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </ParchmentCard>
    </div>
  );
}
