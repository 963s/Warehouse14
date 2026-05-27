/**
 * CustomerPanel — left column of Ankauf (Day 8).
 *
 * Three modes:
 *   1. UNSELECTED — magnifier search input + recent-matches dropdown +
 *      "Neuer Kunde anlegen" CTA. Items panel locked until a customer
 *      is chosen.
 *   2. SELECTED   — full customer card: name, KYC status chip, trust
 *      level chip, sanctions warning (if any), cumulative Ankauf
 *      history. "Anderer Kunde" link to return to mode 1.
 *   3. CREATING   — inline minimal-field form (full name + DOB + ID
 *      number + ID country + email + phone + address). Calls
 *      customersApi.create + auto-selects.
 *
 * Sanctions hard-block: if the selected customer has sanctions_match=TRUE,
 * the panel locks the items column with a wax-red lock screen ("Geschäft
 * kann nicht durchgeführt werden"). Backend would refuse anyway; the
 * client prevents the operator from wasting effort.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  customersApi,
  type CustomerCreateBody,
  type CustomerDetail,
  type CustomerListRow,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  MagnifierIcon,
  MoneyAmount,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import {
  useAnkaufCartStore,
  selectAnkaufCustomerId,
} from '../../state/ankauf-cart-store.js';
import { useToastStore } from '../../state/toast-store.js';

type Mode = 'SEARCH' | 'CREATE';

export function CustomerPanel(): JSX.Element {
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const setCustomerId = useAnkaufCartStore((s) => s.setCustomerId);

  if (customerId === null) {
    return (
      <SearchOrCreate
        onSelect={(id) => setCustomerId(id)}
      />
    );
  }
  return (
    <SelectedCustomer
      customerId={customerId}
      onClear={() => setCustomerId(null)}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode 1+3: search OR create
// ────────────────────────────────────────────────────────────────────────

function SearchOrCreate({ onSelect }: { onSelect: (id: string) => void }): JSX.Element {
  const [mode, setMode] = useState<Mode>('SEARCH');
  return (
    <section
      aria-label="Verkäufer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 14,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1.4rem' }}>
          Verkäufer
        </h2>
        <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>
          {mode === 'SEARCH' ? 'suchen oder anlegen' : 'neue Person'}
        </span>
      </header>

      {mode === 'SEARCH' ? (
        <SearchMode onSelect={onSelect} onSwitchToCreate={() => setMode('CREATE')} />
      ) : (
        <CreateMode onCreated={onSelect} onCancel={() => setMode('SEARCH')} />
      )}
    </section>
  );
}

function SearchMode({
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
        excludeBlocked: false, // surface BANNED rows so operator sees the warning
      }),
    staleTime: 10_000,
    enabled: debouncedQ.length > 0,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <>
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
          <span style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
            sucht…
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {debouncedQ.length === 0 ? (
          <EmptyHint />
        ) : items.length === 0 && !q.isFetching ? (
          <NoResults onSwitchToCreate={onSwitchToCreate} />
        ) : (
          items.map((row) => (
            <CustomerResultRow key={row.id} row={row} onSelect={onSelect} />
          ))
        )}
      </div>

      <Button variant="ghost" size="md" onClick={onSwitchToCreate}>
        + Neuer Kunde anlegen
      </Button>
    </>
  );
}

function EmptyHint(): JSX.Element {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic', fontSize: '0.92rem' }}>
        Geben Sie Name oder Kontakt ein,<br />um den Verkäufer zu finden.
      </p>
    </div>
  );
}

function NoResults({ onSwitchToCreate }: { onSwitchToCreate: () => void }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <p style={{ margin: '0 0 10px', color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
        Kein Treffer.
      </p>
      <Button variant="primary" size="sm" onClick={onSwitchToCreate}>
        + Als neuen Kunden anlegen
      </Button>
    </ParchmentCard>
  );
}

function CustomerResultRow({
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.fullName}
          </div>
          <div className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
            {row.customerNumber}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <KycChip kyc={row.kycVerifiedAt !== null} trust={row.trustLevel} sanctions={row.sanctionsMatch} />
          <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>
            Ank. <MoneyAmount valueEur={row.cumulativeAnkaufEur} />
          </span>
        </div>
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
  trust: 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
  sanctions: boolean;
}): JSX.Element {
  if (sanctions) {
    return (
      <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color: 'var(--w14-wax-red)', letterSpacing: '0.08em' }}>
        Sanktioniert
      </span>
    );
  }
  if (trust === 'BANNED') {
    return (
      <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color: 'var(--w14-wax-red)', letterSpacing: '0.08em' }}>
        gesperrt
      </span>
    );
  }
  if (trust === 'SUSPICIOUS') {
    return (
      <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color: 'var(--w14-wax-red)', letterSpacing: '0.08em' }}>
        beobachten
      </span>
    );
  }
  if (kyc) {
    return (
      <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color: 'var(--w14-gold)', letterSpacing: '0.08em' }}>
        KYC ✓
      </span>
    );
  }
  return (
    <span className="w14-smallcaps" style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)', letterSpacing: '0.08em' }}>
      ohne KYC
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode 2: selected customer
// ────────────────────────────────────────────────────────────────────────

function SelectedCustomer({
  customerId,
  onClear,
}: {
  customerId: string;
  onClear: () => void;
}): JSX.Element {
  const api = useApiClient();

  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 10_000,
  });

  return (
    <section
      aria-label="Verkäufer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 14,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1.4rem' }}>
          Verkäufer
        </h2>
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
          anderer Kunde
        </button>
      </header>

      {q.isLoading && <SkeletonCard />}
      {q.isError && (
        <ParchmentCard padding="md">
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: '0.92rem' }}>
            Verkäuferdaten konnten nicht geladen werden.
          </p>
        </ParchmentCard>
      )}
      {q.data && <CustomerCard detail={q.data} />}
    </section>
  );
}

function SkeletonCard(): JSX.Element {
  return (
    <ParchmentCard padding="md">
      <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
        Lädt Verkäufer…
      </p>
    </ParchmentCard>
  );
}

function CustomerCard({ detail }: { detail: CustomerDetail }): JSX.Element {
  const blocked = detail.sanctionsMatch || detail.trustLevel === 'BANNED';

  return (
    <>
      {blocked && (
        <ParchmentCard
          padding="md"
          style={{ border: '2px solid var(--w14-wax-red)', background: 'var(--w14-parchment-3)' }}
        >
          <p style={{ margin: 0, color: 'var(--w14-wax-red)', fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1rem' }}>
            Geschäft mit diesem Kunden nicht zulässig.
          </p>
          <p style={{ margin: '6px 0 0', color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic', fontSize: '0.85rem' }}>
            {detail.sanctionsMatch
              ? 'Sanktionslisten-Treffer — Verstoß gegen EU-Verordnung.'
              : 'Kunde ist gesperrt — siehe Notizen.'}
          </p>
        </ParchmentCard>
      )}

      <ParchmentCard padding="md">
        <DiamondRule />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1.15rem' }}>
            {detail.fullName}
          </h3>
          <KycChip kyc={detail.kycVerifiedAt !== null} trust={detail.trustLevel} sanctions={detail.sanctionsMatch} />
        </div>
        <p className="w14-tabular" style={{ margin: '4px 0 8px', fontFamily: 'var(--w14-font-mono)', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
          {detail.customerNumber}
        </p>

        <Row label="Geburtsdatum" value={detail.dateOfBirth ?? '—'} />
        <Row label="E-Mail" value={detail.email ?? '—'} />
        <Row label="Telefon" value={detail.phone ?? '—'} />
        <Row label="Adresse" value={detail.address ?? '—'} multiline />

        <DiamondRule label="Bisher" />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>
            Ankäufe
          </span>
          <MoneyAmount valueEur={detail.cumulativeAnkaufEur} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
          <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>
            Verkäufe an
          </span>
          <MoneyAmount valueEur={detail.cumulativeSpendEur} />
        </div>
      </ParchmentCard>
    </>
  );
}

function Row({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 10,
        padding: '6px 0',
        alignItems: multiline ? 'start' : 'baseline',
      }}
    >
      <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span style={{ fontFamily: multiline ? 'var(--w14-font-body)' : 'var(--w14-font-mono)', fontSize: '0.92rem', textAlign: 'right', whiteSpace: multiline ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode 3: create
// ────────────────────────────────────────────────────────────────────────

function CreateMode({
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
      const body: CustomerCreateBody = {
        fullName: fullName.trim(),
        ...(dateOfBirth.trim() ? { dateOfBirth: dateOfBirth.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      };
      const created = await customersApi.create(api, body);
      addToast({ tone: 'success', title: 'Kunde angelegt', body: created.customerNumber });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onCreated(created.id);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Verbindung gestört — Netzwerk prüfen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Vollständiger Name" value={fullName} onChange={setFullName} autoFocus required />
        <Field label="Geburtsdatum (TT.MM.JJJJ)" value={dateOfBirth} onChange={setDateOfBirth} />
        <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
        <Field label="Telefon" value={phone} onChange={setPhone} />
        <Field label="Adresse" value={address} onChange={setAddress} multiline />
      </ParchmentCard>

      {error && (
        <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: '0.92rem', textAlign: 'center' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        <Button variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="primary" size="md" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Speichert…' : 'Anlegen'}
        </Button>
      </div>
    </>
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
      <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}>
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
