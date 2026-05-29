/**
 * KycCaptureModal — capture/upload an identity document and store it in the
 * encrypted local KYC vault (Epic C, GwG/GDPR).
 *
 * The raw bytes are handed to the Rust bridge (`encrypt_and_save_kyc_document`)
 * which AES-256-GCM-encrypts them under the OS-keyring master key and writes
 * the ciphertext to `$APP_DATA/kyc_vault/`. Only the opaque vault path + the
 * SHA-256 integrity hash come back — the plaintext never touches JS storage.
 *
 * `<input type="file" capture>` opens the device camera on capable hardware
 * and a file picker otherwise, covering both "scan now" and "attach existing".
 */

import { useState } from 'react';

import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import {
  type KycDocType,
  type KycEncryptResult,
  describeHardwareError,
  encryptAndSaveKycDocument,
  isHardwareError,
} from '../../lib/hardware-client.js';
import { useToastStore } from '../../state/toast-store.js';

const DOC_TYPES: { value: KycDocType; label: string }[] = [
  { value: 'AUSWEIS', label: 'Personalausweis' },
  { value: 'REISEPASS', label: 'Reisepass' },
  { value: 'AUFENTHALTSTITEL', label: 'Aufenthaltstitel' },
  { value: 'SONSTIGES', label: 'Sonstiges' },
];

export function KycCaptureModal({
  customerId,
  onClose,
  onSaved,
}: {
  customerId: string;
  onClose: () => void;
  onSaved?: (result: KycEncryptResult) => void;
}): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  const [docType, setDocType] = useState<KycDocType>('AUSWEIS');
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await encryptAndSaveKycDocument(bytes, customerId, docType);
      addToast({
        tone: 'success',
        title: 'Ausweis verschlüsselt gespeichert',
        body: `SHA-256 ${result.sha256.slice(0, 12)}…`,
      });
      onSaved?.(result);
      onClose();
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Verschlüsseln fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role="dialog" to match the existing modal pattern in this app
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ausweis erfassen"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 10, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Ausweis erfassen
        </h2>
        <DiamondRule />

        <p style={{ margin: '8px 0 0', fontSize: '0.84rem', color: 'var(--w14-ink-aged)' }}>
          Das Dokument wird lokal AES-256-GCM-verschlüsselt im Tresor abgelegt. Der Schlüssel
          verbleibt im OS-Schlüsselbund; unverschlüsselte Daten werden nie gespeichert.
        </p>

        <label
          htmlFor="w14-kyc-doctype"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            marginTop: 12,
          }}
        >
          Dokumenttyp
        </label>
        <select
          id="w14-kyc-doctype"
          value={docType}
          onChange={(e) => setDocType(e.target.value as KycDocType)}
          style={selectStyle}
        >
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>

        <label
          htmlFor="w14-kyc-file"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            marginTop: 12,
          }}
        >
          Aufnahme / Datei
        </label>
        <input
          id="w14-kyc-file"
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          disabled={busy}
          onChange={(e) => void handleFile(e.target.files?.[0])}
          style={{ marginTop: 6, fontFamily: 'var(--w14-font-body)', fontSize: '0.9rem' }}
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Verschlüsselt…' : 'Schließen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink)',
  outline: 'none',
  marginTop: 6,
};
