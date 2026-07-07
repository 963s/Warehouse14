/**
 * KaeuferPicker — § 10 GwG buyer-attach + Ausweisprüfung step for the Verkauf
 * checkout.
 *
 * Mandatory whenever a sale total ≥ €2.000 (GwG-Schwelle): the server trigger
 * `transactions_validate_kyc` refuses an anonymous high-value VERKAUF, so the
 * cashier MUST attach a KYC-verified buyer before finalize. This modal is the
 * UX that makes that satisfiable:
 *
 *   1. SEARCH  — debounced customer search (reuses `customersApi.list`, the
 *      exact pattern from Ankauf's CustomerPanel), each row showing its KYC
 *      chip so the operator can spot an already-verified buyer at a glance.
 *   2. CREATE  — inline minimal-field create (`customersApi.create`) for a
 *      walk-in with no record yet, then auto-selects.
 *   3. VERIFY  — once a buyer is selected, show the KYC status. If not yet
 *      verified, a single "Ausweis geprüft — bestätigen" button stamps KYC
 *      (`customersApi.stampKyc`, step-up enforced by the api-client
 *      interceptor — same eyeball-verify flow as Ankauf). Only a verified
 *      buyer can be handed back to the dialog.
 *
 * Below €2.000 this picker is never shown — anonymous Tafelgeschäft stays
 * unchanged. This is purely the UX so the cashier CAN satisfy the gate; the
 * server trigger remains the authoritative source of truth.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerDetail,
  type CustomerListRow,
  customersApi,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  Icon,
  MagnifierIcon,
  MoneyAmount,
  ParchmentCard,
  ShieldCheck,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

type Mode = 'SEARCH' | 'CREATE' | 'SELECTED';

export interface KaeuferPickerProps {
  /** Sale total (€ string) — shown in the header so the operator sees why ID is needed. */
  totalEur: string;
  /** Optional: a buyer already chosen earlier in this checkout (re-open keeps it). */
  initialCustomerId?: string | null;
  /** Fired with the chosen buyer ONCE they are KYC-verified — attaches to finalize. */
  onConfirm: (customer: CustomerDetail) => void;
  onCancel: () => void;
}

export function KaeuferPicker({
  totalEur,
  initialCustomerId,
  onConfirm,
  onCancel,
}: KaeuferPickerProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(initialCustomerId ?? null);
  const [mode, setMode] = useState<Mode>(initialCustomerId ? 'SELECTED' : 'SEARCH');

  // Esc cancels.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setMode('SELECTED');
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Käufer zuordnen — Ausweis erforderlich"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 1060,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        <header style={{ flexShrink: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
              textAlign: 'center',
            }}
          >
            Käufer zuordnen
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.88rem',
            }}
          >
            Ausweis erforderlich ab 2.000&nbsp;€ (§ 10 GwG) · Verkauf{' '}
            <MoneyAmount valueEur={totalEur} />
          </p>
          <DiamondRule />
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex' }}>
          {mode === 'SELECTED' && selectedId !== null ? (
            <SelectedBuyer
              customerId={selectedId}
              onConfirm={onConfirm}
              onClear={() => {
                setSelectedId(null);
                setMode('SEARCH');
              }}
            />
          ) : mode === 'CREATE' ? (
            <CreateBuyer onCreated={select} onCancel={() => setMode('SEARCH')} />
          ) : (
            <SearchBuyer onSelect={select} onSwitchToCreate={() => setMode('CREATE')} />
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 12,
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--w14-rule)',
          }}
        >
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SEARCH
// ────────────────────────────────────────────────────────────────────────

function SearchBuyer({
  onSelect,
  onSwitchToCreate,
}: {
  onSelect: (id: string) => void;
  onSwitchToCreate: () => void;
}): JSX.Element {
  const api = useApiClient();
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQ, setDebouncedQ] = useState<string>('');

  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 240);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [searchInput]);

  const q = useQuery({
    queryKey: ['customers', 'list', { q: debouncedQ }],
    queryFn: () =>
      customersApi.list(api, {
        ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
        limit: 20,
        excludeBlocked: false, // surface BANNED rows so the operator sees the warning
      }),
    staleTime: 10_000,
    enabled: debouncedQ.length > 0,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          backgroundColor: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <MagnifierIcon size={20} tone="ink" />
        <input
          type="text"
          value={searchInput}
          onChange={(ev) => setSearchInput(ev.target.value)}
          placeholder="Name · E-Mail · Telefon"
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        />
        {q.isFetching && (
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.78rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            sucht…
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {debouncedQ.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: 16,
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.92rem',
            }}
          >
            Name oder Kontakt eingeben, um den Käufer zu finden.
          </p>
        ) : items.length === 0 && !q.isFetching ? (
          <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
            <p
              style={{
                margin: '0 0 10px',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
              }}
            >
              Kein Treffer.
            </p>
            <Button variant="primary" size="sm" onClick={onSwitchToCreate}>
              + Als neuen Kunden anlegen
            </Button>
          </ParchmentCard>
        ) : (
          items.map((row) => <ResultRow key={row.id} row={row} onSelect={onSelect} />)
        )}
      </div>

      <Button variant="ghost" size="md" onClick={onSwitchToCreate}>
        + Neuer Kunde anlegen
      </Button>
    </div>
  );
}

function ResultRow({
  row,
  onSelect,
}: {
  row: CustomerListRow;
  onSelect: (id: string) => void;
}): JSX.Element {
  const banned = row.sanctionsMatch || row.trustLevel === 'BANNED';
  return (
    <ParchmentCard
      padding="sm"
      style={{
        cursor: banned ? 'not-allowed' : 'pointer',
        opacity: banned ? 0.55 : 1,
        border: banned ? '1px solid var(--w14-wax-red)' : '1px solid transparent',
      }}
      onClick={() => {
        if (!banned) onSelect(row.id);
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.fullName}
          </div>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.78rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {row.customerNumber}
          </div>
        </div>
        <KycChip
          kyc={row.kycVerifiedAt !== null}
          trust={row.trustLevel}
          sanctions={row.sanctionsMatch}
        />
      </div>
    </ParchmentCard>
  );
}

function KycChip({
  kyc,
  trust,
  sanctions,
}: {
  kyc: boolean;
  trust: CustomerListRow['trustLevel'];
  sanctions: boolean;
}): JSX.Element {
  const base = {
    className: 'w14-smallcaps',
    style: { fontSize: '0.72rem', letterSpacing: '0.08em' } as const,
  };
  if (sanctions)
    return (
      <span {...base} style={{ ...base.style, color: 'var(--w14-wax-red)' }}>
        Sanktioniert
      </span>
    );
  if (trust === 'BANNED')
    return (
      <span {...base} style={{ ...base.style, color: 'var(--w14-wax-red)' }}>
        gesperrt
      </span>
    );
  if (trust === 'SUSPICIOUS')
    return (
      <span {...base} style={{ ...base.style, color: 'var(--w14-wax-red)' }}>
        beobachten
      </span>
    );
  if (kyc)
    return (
      <span {...base} style={{ ...base.style, color: 'var(--w14-gold)' }}>
        KYC ✓
      </span>
    );
  return (
    <span {...base} style={{ ...base.style, color: 'var(--w14-ink-faded)' }}>
      ohne KYC
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SELECTED — show KYC status, stamp if needed, then confirm
// ────────────────────────────────────────────────────────────────────────

function SelectedBuyer({
  customerId,
  onConfirm,
  onClear,
}: {
  customerId: string;
  onConfirm: (customer: CustomerDetail) => void;
  onClear: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [stamping, setStamping] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 5_000,
  });
  const customer = q.data;

  const blocked = customer?.sanctionsMatch === true || customer?.trustLevel === 'BANNED';
  const kycVerified = customer?.kycVerifiedAt != null;

  const stampKyc = useCallback(async (): Promise<void> => {
    if (!customer || stamping) return;
    setStamping(true);
    setError(null);
    try {
      // The PATCH route requires step-up — the api-client interceptor opens the
      // PIN modal and retries transparently (same eyeball-verify as Ankauf).
      // documentType is a required backend audit enum: PERSONALAUSWEIS is the
      // honest default ID inspected at a German counter (metadata only).
      await customersApi.stampKyc(
        api,
        customer.id,
        customer.trustLevel === 'NEW'
          ? { documentType: 'PERSONALAUSWEIS', promoteTrustLevelTo: 'VERIFIED' }
          : { documentType: 'PERSONALAUSWEIS' },
      );
      addToast({ tone: 'success', title: 'Ausweis bestätigt', body: customer.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'STEP_UP_REQUIRED' ? 'PIN-Bestätigung wurde abgebrochen.' : describeError(err),
        );
      } else {
        setError('Verbindung gestört — Ausweis nicht bestätigt.');
      }
    } finally {
      setStamping(false);
    }
  }, [addToast, api, customer, qc, stamping]);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          anderer Käufer
        </button>
      </div>

      {q.isLoading && (
        <ParchmentCard padding="md">
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
            }}
          >
            Lädt Käufer…
          </p>
        </ParchmentCard>
      )}
      {q.isError && (
        <ParchmentCard padding="md">
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: '0.92rem' }}>
            Käuferdaten konnten nicht geladen werden.
          </p>
        </ParchmentCard>
      )}

      {customer && (
        <>
          {blocked && (
            <ParchmentCard
              padding="md"
              style={{
                border: '2px solid var(--w14-wax-red)',
                background: 'var(--w14-parchment-3)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: 'var(--w14-wax-red)',
                  fontFamily: 'var(--w14-font-display)',
                  fontWeight: 500,
                  fontSize: '1rem',
                }}
              >
                Verkauf an diesen Kunden nicht zulässig.
              </p>
              <p
                style={{
                  margin: '6px 0 0',
                  color: 'var(--w14-ink-faded)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                  fontSize: '0.85rem',
                }}
              >
                {customer.sanctionsMatch
                  ? 'Sanktionslisten-Treffer — Verstoß gegen EU-Verordnung.'
                  : 'Kunde ist gesperrt — siehe Notizen.'}
              </p>
            </ParchmentCard>
          )}

          <ParchmentCard padding="md">
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--w14-font-display)',
                  fontWeight: 500,
                  fontSize: '1.15rem',
                }}
              >
                {customer.fullName}
              </h3>
              <KycChip
                kyc={kycVerified}
                trust={customer.trustLevel}
                sanctions={customer.sanctionsMatch}
              />
            </div>
            <p
              className="w14-tabular"
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {customer.customerNumber}
              {customer.dateOfBirth ? ` · geb. ${customer.dateOfBirth}` : ''}
            </p>

            <p
              style={{
                margin: '12px 0 0',
                fontFamily: 'var(--w14-font-display)',
                fontSize: '0.9rem',
                color: kycVerified ? 'var(--w14-gold)' : 'var(--w14-wax-red)',
              }}
            >
              {kycVerified
                ? `Ausweis geprüft am ${
                    customer.kycVerifiedAt
                      ? new Date(customer.kycVerifiedAt).toLocaleDateString('de-DE')
                      : '—'
                  }`
                : 'Ausweis noch nicht geprüft — § 10 GwG verlangt eine Identifizierung.'}
            </p>
          </ParchmentCard>

          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--w14-wax-red)',
                margin: 0,
                fontSize: '0.92rem',
                textAlign: 'center',
              }}
            >
              {error}
            </p>
          )}

          {!blocked &&
            (kycVerified ? (
              <Button
                variant="primary"
                size="lg"
                iconLeft={<Icon icon={ShieldCheck} size={18} />}
                onClick={() => onConfirm(customer)}
                style={{
                  backgroundColor: 'var(--w14-accent)',
                  borderColor: 'var(--w14-accent)',
                  color: 'var(--w14-accent-ink)',
                }}
              >
                Käufer übernehmen
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void stampKyc()}
                disabled={stamping}
              >
                {stamping ? 'Bestätigt…' : 'Ausweis geprüft — bestätigen'}
              </Button>
            ))}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────────────────

function CreateBuyer({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [fullName, setFullName] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = fullName.trim().length >= 2 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const rawDob = dateOfBirth.trim();
      const dobIso = rawDob ? germanDateToIso(rawDob) : null;
      if (rawDob && !dobIso) {
        setError('Geburtsdatum bitte als TT.MM.JJJJ eingeben (z. B. 15.06.1990).');
        setSubmitting(false);
        return;
      }
      const body: CustomerCreateBody = {
        fullName: fullName.trim(),
        ...(dobIso ? { dateOfBirth: dobIso } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      };
      const created = await customersApi.create(api, body);
      addToast({ tone: 'success', title: 'Kunde angelegt', body: created.customerNumber });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onCreated(created.id);
    } catch (err) {
      if (err instanceof ApiError) setError(describeError(err));
      else setError('Verbindung gestört — Netzwerk prüfen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field
          label="Vollständiger Name"
          value={fullName}
          onChange={setFullName}
          autoFocus
          required
        />
        <Field label="Geburtsdatum (TT.MM.JJJJ)" value={dateOfBirth} onChange={setDateOfBirth} />
        <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
        <Field label="Telefon" value={phone} onChange={setPhone} />
        <Field label="Adresse" value={address} onChange={setAddress} multiline />
      </ParchmentCard>

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: 0,
            fontSize: '0.92rem',
            textAlign: 'center',
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Zurück
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void submit()}
          disabled={!canSubmit}
          style={{ flex: 1 }}
        >
          {submitting ? 'Speichert…' : 'Anlegen'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus = false,
  required = false,
  type = 'text',
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  required?: boolean;
  type?: 'text' | 'email' | 'tel';
  multiline?: boolean;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
      >
        {label}
        {required && <span style={{ color: 'var(--w14-wax-red)' }}> *</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={2}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '6px 4px',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.95rem',
            resize: 'vertical',
            color: 'var(--w14-ink)',
          }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          autoFocus={autoFocus}
          spellCheck={false}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '6px 4px',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}
