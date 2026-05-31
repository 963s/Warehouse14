/**
 * ApprovalsPanel — the Genehmigungen surface (ADR-0019 §7). The ADMIN's queue
 * of high-value sales the POS paused for explicit approval. Each card answers
 * "what's waiting and is it safe?" — terminal, cashier, amount, items, and a
 * KYC / Sanctions / PEP checklist — then offers Approve (with a quick confirm,
 * standing in for the WebAuthn touch) or Reject (which requires a reason).
 *
 * Data: TanStack Query against `/api/approvals/pending`; resolution is a
 * mutation against `/api/approvals/:id/resolve` that, on success, fires a
 * success toast and invalidates both the approvals list and the Bridge
 * overview (whose `quickActions.approvals` count drops).
 */

import { type CSSProperties, useEffect, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Button,
  DiamondRule,
  MoneyAmount,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';

const FOCUSABLE = 'w14cd-focusable';

interface PendingApproval {
  id: string;
  eventId: string;
  requestedAt: string;
  posTerminal: string;
  cashierName: string;
  amountEur: string;
  customerName: string;
  items: string[];
  kycComplete: boolean;
  sanctionsMatch: boolean;
  pepMatch: boolean;
}

interface PendingResponse {
  items: PendingApproval[];
}

interface ResolveResponse {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  resolvedAt: string;
  ledgerEventId: string;
}

type ActionState = { id: string; mode: 'approve' | 'reject'; reason: string } | null;

const APPROVALS_KEY = ['approvals', 'pending'] as const;

/** German "pending for X" from an ISO timestamp + a ticking now. */
function sinceLabel(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min`;
  return `${Math.floor(m / 60)} Std`;
}

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

export function ApprovalsPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionState>(null);
  const [toasts, setToasts] = useState<ToastShape[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick the pending-duration counter once a second (cheap; small list).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void => {
    const toast: ToastShape = {
      id: crypto.randomUUID(),
      tone,
      title,
      autoDismissMs: 4000,
      ...(body ? { body } : {}),
    };
    setToasts((prev) => [...prev, toast]);
  };

  const dismissToast = (id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const query = useQuery<PendingResponse>({
    queryKey: [...APPROVALS_KEY, baseUrl],
    queryFn: () => client.request<PendingResponse>('GET', '/api/approvals/pending'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const resolve = useMutation<
    ResolveResponse,
    Error,
    { id: string; status: 'APPROVED' | 'REJECTED'; reason?: string }
  >({
    mutationFn: (vars) =>
      client.request<ResolveResponse>('POST', `/api/approvals/${vars.id}/resolve`, {
        status: vars.status,
        ...(vars.reason ? { reason: vars.reason } : {}),
      }),
    onSuccess: (res) => {
      pushToast(
        'success',
        res.status === 'APPROVED' ? 'Verkauf freigegeben' : 'Verkauf abgelehnt',
        `Im Prüfprotokoll erfasst (Ereignis #${res.ledgerEventId}).`,
      );
      setAction(null);
      void queryClient.invalidateQueries({ queryKey: APPROVALS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['bridge', 'overview'] });
    },
    onError: (err) => {
      pushToast('alert', 'Aktion fehlgeschlagen', err.message);
    },
  });

  const items = query.data?.items ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Genehmigungen" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20 }}>
        Hochwertige Verkäufe, die an der Kasse auf deine Freigabe warten (ADR-0019 §7).
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 720 }}>
          <p style={captionStyle}>Lädt offene Genehmigungen …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusDot tone="ok" size={12} />
            <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem' }}>
              Keine offenen Genehmigungen
            </p>
          </div>
          <p style={{ ...captionStyle, marginTop: 8 }}>
            Alles freigegeben — die Pipeline ist ruhig.
          </p>
        </ParchmentCard>
      ) : (
        <div style={{ display: 'grid', gap: 18, maxWidth: 720 }}>
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              now={now}
              action={action?.id === item.id ? action : null}
              busy={resolve.isPending}
              onApproveClick={() => setAction({ id: item.id, mode: 'approve', reason: '' })}
              onRejectClick={() => setAction({ id: item.id, mode: 'reject', reason: '' })}
              onReasonChange={(reason) => setAction((prev) => (prev ? { ...prev, reason } : prev))}
              onCancel={() => setAction(null)}
              onConfirmApprove={() => resolve.mutate({ id: item.id, status: 'APPROVED' })}
              onConfirmReject={(reason) =>
                resolve.mutate({ id: item.id, status: 'REJECTED', reason })
              }
            />
          ))}
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

function ChecklistRow({ tone, text }: { tone: StatusTone; text: string }): JSX.Element {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <StatusDot tone={tone} size={10} />
      <span style={{ fontSize: '0.92rem' }}>{text}</span>
    </li>
  );
}

function ApprovalCard({
  item,
  now,
  action,
  busy,
  onApproveClick,
  onRejectClick,
  onReasonChange,
  onCancel,
  onConfirmApprove,
  onConfirmReject,
}: {
  item: PendingApproval;
  now: number;
  action: { id: string; mode: 'approve' | 'reject'; reason: string } | null;
  busy: boolean;
  onApproveClick: () => void;
  onRejectClick: () => void;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirmApprove: () => void;
  onConfirmReject: (reason: string) => void;
}): JSX.Element {
  const reasonValid = action?.mode === 'reject' && action.reason.trim().length > 0;

  return (
    <ParchmentCard
      tone="parchment"
      padding="lg"
      style={{ borderLeft: '3px solid var(--w14-gold)' }}
    >
      {/* Header — terminal · cashier · amount */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.2rem' }}>
          {item.posTerminal} · {item.cashierName}
        </h2>
        <MoneyAmount valueEur={item.amountEur} emphasis />
      </div>

      <p style={{ ...captionStyle, marginTop: 6 }}>
        Kunde: <strong style={{ color: 'var(--w14-ink)' }}>{item.customerName}</strong>
      </p>

      {item.items.length > 0 ? (
        <p style={{ ...captionStyle, marginTop: 4 }}>{item.items.join(' · ')}</p>
      ) : null}

      {/* KYC / Sanctions / PEP checklist */}
      <ul
        style={{
          listStyle: 'none',
          margin: '14px 0 0',
          padding: 0,
          display: 'grid',
          gap: 8,
        }}
      >
        <ChecklistRow
          tone={item.kycComplete ? 'ok' : 'watch'}
          text={item.kycComplete ? 'KYC vollständig' : 'KYC unvollständig'}
        />
        <ChecklistRow
          tone={item.sanctionsMatch ? 'alert' : 'ok'}
          text={item.sanctionsMatch ? 'Sanktionen: Treffer' : 'Sanktionen: kein Treffer'}
        />
        <ChecklistRow
          tone={item.pepMatch ? 'alert' : 'ok'}
          text={item.pepMatch ? 'PEP: Treffer' : 'PEP: kein Treffer'}
        />
      </ul>

      <p style={{ ...captionStyle, marginTop: 12 }}>
        Wartet seit <span className="w14-tabular">{sinceLabel(item.requestedAt, now)}</span>
      </p>

      <DiamondRule tone="faded" style={{ margin: '16px 0' }} />

      {/* Action zone — idle buttons, or the confirm / reject sub-flows */}
      {action?.mode === 'approve' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--w14-font-display)' }}>Freigabe bestätigen?</span>
          <Button
            className={FOCUSABLE}
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={onConfirmApprove}
          >
            ✓ Bestätigen
          </Button>
          <Button
            className={FOCUSABLE}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Abbrechen
          </Button>
        </div>
      ) : action?.mode === 'reject' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <label
            htmlFor={`reason-${item.id}`}
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)' }}
          >
            Ablehnungsgrund (erforderlich)
          </label>
          <input
            id={`reason-${item.id}`}
            className={FOCUSABLE}
            type="text"
            value={action.reason}
            disabled={busy}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="z. B. Herkunft der Mittel unklar"
            style={{
              padding: '8px 12px',
              border: '1px solid var(--w14-ink-faded)',
              borderRadius: 'var(--w14-radius-button)',
              background: 'var(--w14-parchment)',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.95rem',
            }}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              className={FOCUSABLE}
              variant="destructive"
              size="sm"
              disabled={busy || !reasonValid}
              onClick={() => onConfirmReject(action.reason.trim())}
            >
              ✗ Ablehnung bestätigen
            </Button>
            <Button
              className={FOCUSABLE}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onCancel}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            className={FOCUSABLE}
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={onApproveClick}
          >
            ✓ Freigeben
          </Button>
          <Button
            className={FOCUSABLE}
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onRejectClick}
          >
            ✗ Ablehnen
          </Button>
        </div>
      )}
    </ParchmentCard>
  );
}
