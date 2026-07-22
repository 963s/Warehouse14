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
 *
 * WHAT AN AUDIT CAUGHT IN THE FIRST DRAFT, and why each one mattered:
 *
 *   • ONE draft for the whole screen. Type two sentences to Frau A, get
 *     interrupted, open Herr B's ticket, and A's half-written text was sitting
 *     in B's box ready to be mailed to him. Drafts are now per ticket.
 *   • The status buttons had no catch. On a 403 or a dropped line the button
 *     simply un-greyed and the operator walked away believing the ticket was
 *     closed. It was not.
 *   • A failed request rendered the cheerful empty state, so a broken inbox
 *     looked like a quiet one. Worse on the detail: an empty thread plus a
 *     live reply box, inviting an answer to a question never shown.
 *   • The headline counted only the FILTERED rows but spoke for the whole
 *     shop, so opening "Geschlossen" announced that nobody was waiting while
 *     four people were.
 *   • `?? t.status` printed a raw enum if the server ever grew a fourth one.
 *
 * Buttons come from the shared kit. The first draft hand-rolled them and
 * filled them with gilt, which the design system forbids outright: gold is a
 * thread, an edge, a seal, never a fill.
 */

import { useCallback, useMemo, useState } from 'react';

import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';
import { supportApi } from '@warehouse14/api-client';
import type { SupportTicketDetail, TicketStatus } from '@warehouse14/api-client';

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { useApiClient } from '../../lib/api-context.js';

const STATUS_LABEL: Record<string, string> = {
  OFFEN: 'Offen',
  WARTET: 'Wartet auf Kundin oder Kunde',
  GESCHLOSSEN: 'Geschlossen',
};

/** Never a raw enum on screen: an unknown status degrades to a German word. */
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? 'Unbekannter Stand';
}

const BUCKETS = ['ALLE', 'OFFEN', 'WARTET', 'GESCHLOSSEN'] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketLabel(b: Bucket): string {
  return b === 'ALLE' ? 'Alle offenen' : statusLabel(b);
}

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
  // ONE draft PER TICKET. A single shared draft mailed one customer's
  // half-written answer to the next customer the operator clicked on.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>('ALLE');

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
  const draft = openId ? (drafts[openId] ?? '') : '';

  // A read that never answered is not an empty inbox. Distinguish the two.
  const listFailed = listQ.isError && listQ.data === undefined;
  const detailFailed = openId != null && detailQ.isError && detailQ.data == null;

  const setDraft = useCallback(
    (value: string) => {
      if (!openId) return;
      setDrafts((prev) => ({ ...prev, [openId]: value }));
    },
    [openId],
  );

  const send = useCallback(async () => {
    if (!openId || !draft.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await supportApi.reply(api, openId, draft.trim());
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[openId];
        return next;
      });
      setNote(`Antwort zu ${res.ticketNumber} ist in der Warteschlange.`);
      listQ.refetch();
      detailQ.refetch();
    } catch (e) {
      // The reply is queued, not sent inline, so the only honest thing to
      // report is whether it was ACCEPTED. Claiming "sent" here would be a
      // guess about a worker tick that has not happened yet.
      //
      // describeError, never `e.message`: a raw server string is English and
      // written for a log, and the counter reads German.
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [api, openId, draft, busy, listQ, detailQ]);

  const setStatus = useCallback(
    async (status: TicketStatus) => {
      if (!openId || busy) return;
      setBusy(true);
      setErr(null);
      setNote(null);
      try {
        await supportApi.setStatus(api, openId, status);
        listQ.refetch();
        detailQ.refetch();
      } catch (e) {
        // Without this the button just un-greyed and the operator walked away
        // believing a ticket was closed that is still open.
        setErr(describeError(e));
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
        {/* The count belongs to the OPEN bucket the reader is looking at. Said
            plainly, because a shop-wide all-clear read off a filtered list is
            how somebody closes the app with four people still waiting. */}
        <p style={{ color: 'var(--w14-ink-faded)', fontSize: '0.9rem', marginTop: 4 }}>
          {listFailed
            ? 'Der Stand ist gerade unbekannt.'
            : bucket === 'ALLE'
              ? waiting > 0
                ? `${waiting} ${waiting === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf eine Antwort.`
                : 'Keine Anfrage wartet auf eine Antwort.'
              : `${tickets.length} im Fach ${bucketLabel(bucket)}${
                  waiting > 0 ? `, davon ${waiting} wartend` : ''
                }.`}
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
                // Gold is the EDGE of the chosen chip, never its fill.
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
              Die Anfragen konnten nicht geladen werden. Ob welche warten, ist gerade nicht bekannt.
            </p>
            <div>
              <Button variant="ghost" size="sm" onClick={() => listQ.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          </div>
        ) : listQ.isLoading && tickets.length === 0 ? (
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
                  {statusLabel(t.status)}
                  {t.lastInboundAt ? ` · ${whenLabel(t.lastInboundAt)}` : ''}
                </div>
              </button>

              {openId === t.id && (
                <div style={{ paddingBottom: '0.75rem' }}>
                  {detailFailed ? (
                    // No reply box here on purpose. Offering one under an
                    // unloaded thread invites an answer to a question the
                    // operator was never shown.
                    <div style={{ display: 'grid', gap: '0.6rem', padding: '0.4rem 0' }}>
                      <p style={{ color: 'var(--w14-wax-red)', fontSize: '0.85rem', margin: 0 }}>
                        Der Verlauf konnte nicht geladen werden. Es wäre eine Antwort ins Blaue.
                      </p>
                      <div>
                        <Button variant="ghost" size="sm" onClick={() => detailQ.refetch()}>
                          Erneut versuchen
                        </Button>
                      </div>
                    </div>
                  ) : detailQ.isLoading && !detail ? (
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
                        <p style={{ color: 'var(--w14-verdigris)', fontSize: '0.82rem', margin: '0.4rem 0 0' }}>
                          {note}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => void send()}
                          disabled={busy || draft.trim().length === 0}
                        >
                          {busy ? 'Wird übernommen …' : 'Antwort senden'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="md"
                          onClick={() => void setStatus(t.status === 'GESCHLOSSEN' ? 'OFFEN' : 'GESCHLOSSEN')}
                          disabled={busy}
                        >
                          {t.status === 'GESCHLOSSEN' ? 'Wieder öffnen' : 'Schließen'}
                        </Button>
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
