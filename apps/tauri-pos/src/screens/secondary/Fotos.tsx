/**
 * Foto-Werkstatt — Day 12. Live capture engine + R2 upload pipeline.
 *
 * Three modes (via URL search-params):
 *   • ?mode=produkt&productId=<uuid>  → photos bind to product on register
 *   • ?mode=kyc&customerId=<uuid>     → photos register as kyc_documents row
 *   • (default)                       → orphan upload, bind later
 *
 * Layout:
 *   • Left  : Viewfinder (live <video>) + shutter + camera switcher
 *   • Right : Filmstrip (captured snapshots with upload progress)
 *     + Drag-drop fallback for desktops without a camera
 *     + KYC document form (when mode=kyc)
 *
 * State / persistence: captured-but-not-uploaded blobs live in local
 * component state — never persisted (compliance: no half-bound photos
 * lingering on disk). The server-of-record table (`product_photos` /
 * `kyc_documents`) survives navigation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  ApiError,
  type KycDocumentType,
  type PhotoRow,
  type PhotoUploadIntent,
  customersApi,
  photosApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { CropStudio } from '../../components/hardware/CropStudio.js';
import { useCamera } from '../../hooks/useCamera.js';
import { useApiClient } from '../../lib/api-context.js';
import { sha256HexOfBlob } from '../../lib/image-hash.js';
import {
  photoContentTypeOf,
  uploadBlobToR2,
  uploadProductPhotoViaApi,
} from '../../lib/photo-upload.js';
import { useToastStore } from '../../state/toast-store.js';

type Mode = 'produkt' | 'kyc' | 'allgemein';
type SnapshotStatus = 'queued' | 'uploading' | 'registering' | 'done' | 'failed';

interface Snapshot {
  id: string;
  blob: Blob;
  previewUrl: string;
  status: SnapshotStatus;
  error?: string;
  /** Set once R2 PUT succeeds — drives the register POST. */
  r2Key?: string;
  publicUrl?: string;
  /** Set for KYC mode — used by the form below. */
  sha256Hex?: string;
}

const KYC_DOC_OPTIONS: Array<{ value: KycDocumentType; label: string }> = [
  { value: 'PERSONALAUSWEIS', label: 'Personalausweis' },
  { value: 'REISEPASS', label: 'Reisepass (DE)' },
  { value: 'ID_CARD_EU', label: 'EU-Personalausweis' },
  { value: 'PASSPORT_EU', label: 'EU-Reisepass' },
  { value: 'PASSPORT_NON_EU', label: 'Reisepass Nicht-EU' },
];

export function Fotos(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const mode: Mode = (() => {
    const raw = searchParams.get('mode');
    return raw === 'produkt' || raw === 'kyc' ? raw : 'allgemein';
  })();
  const productId = searchParams.get('productId');
  const customerId = searchParams.get('customerId');
  // Round-trip return (UX P1): when the ProductSheet sent the operator here it
  // passes `returnTo` so this is a STEP, not a dead-end. Internal paths only.
  const returnToRaw = searchParams.get('returnTo');
  const returnTo = returnToRaw?.startsWith('/') ? returnToRaw : null;

  const intent: PhotoUploadIntent =
    mode === 'kyc' ? 'kyc' : mode === 'produkt' ? 'product' : 'orphan';

  const camera = useCamera({ enabled: true });
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const snapshotIdRef = useRef<number>(0);
  // Crop interception (Mandate 1) — every product / orphan photo runs
  // through CropStudio + Rust WebP compression before hitting R2.
  // KYC documents skip the crop (they must remain unaltered for
  // authority review).
  const [pendingCrop, setPendingCrop] = useState<Blob | null>(null);

  // Clean up object URLs on unmount.
  useEffect(() => {
    return () => {
      snapshots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSnapshot = useCallback((blob: Blob): Snapshot => {
    snapshotIdRef.current += 1;
    const snap: Snapshot = {
      id: `snap-${Date.now()}-${snapshotIdRef.current}`,
      blob,
      previewUrl: URL.createObjectURL(blob),
      status: 'queued',
    };
    setSnapshots((prev) => [snap, ...prev]);
    return snap;
  }, []);

  const updateSnapshot = useCallback((id: string, patch: Partial<Snapshot>) => {
    setSnapshots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSnapshot = useCallback((id: string) => {
    setSnapshots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  /**
   * Pipeline:
   *   queued → uploading (R2 PUT) → registering (POST /api/photos) → done
   *   OR failed at any step (operator can retry or discard)
   *
   * For KYC mode the registration step is deferred — the KYC form (below)
   * collects the document fields and submits to /api/customers/:id/kyc-documents.
   * Until then the snapshot stops at status='done' with r2Key+sha256 ready.
   */
  const processSnapshot = useCallback(
    async (snap: Snapshot): Promise<void> => {
      try {
        // KYC mode keeps the presigned-PUT + separate-binding flow because the
        // KYC documents route needs the sha256 of the *unaltered* document.
        if (mode === 'kyc') {
          updateSnapshot(snap.id, { status: 'uploading' });
          const uploaded = await uploadBlobToR2({
            api,
            blob: snap.blob,
            intent,
            // Honour the blob's real type (KYC docs are not WebP-compressed).
            contentType: photoContentTypeOf(snap.blob),
          });
          const sha256Hex = await sha256HexOfBlob(snap.blob);
          updateSnapshot(snap.id, {
            r2Key: uploaded.r2Key,
            publicUrl: uploaded.publicUrl,
            sha256Hex,
            status: 'done',
          });
          return;
        }

        // Product / orphan mode → upload THROUGH the API (server writes R2 +
        // binds the row). No R2-CORS dependency, no separate register call.
        updateSnapshot(snap.id, { status: 'uploading' });
        const row = await uploadProductPhotoViaApi({
          api,
          blob: snap.blob,
          intent,
          ...(mode === 'produkt' && productId ? { productId } : {}),
        });
        updateSnapshot(snap.id, {
          r2Key: row.r2Key,
          publicUrl: row.publicUrl,
          status: 'done',
        });
        // Refresh the product gallery so the new photo (and the auto-primary
        // the backend sets on the FIRST photo) appears immediately, and the
        // Verkauf/Kasse catalog tile picks up the primary thumb.
        if (mode === 'produkt' && productId) {
          void qc.invalidateQueries({ queryKey: ['products', productId, 'photos'] });
          void qc.invalidateQueries({ queryKey: ['products', 'list'] });
        }
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unbekannter Fehler';
        updateSnapshot(snap.id, { status: 'failed', error: message });
      }
    },
    [api, intent, mode, productId, qc, updateSnapshot],
  );

  // Shutter: capture frame, then hand to CropStudio (except KYC mode
  // which preserves the original frame).
  const onShutter = useCallback(async (): Promise<void> => {
    const blob = await camera.captureBlob();
    if (!blob) {
      addToast({
        tone: 'alert',
        title: 'Aufnahme fehlgeschlagen',
        body: 'Kamera-Stream nicht bereit.',
      });
      return;
    }
    if (mode === 'kyc') {
      const snap = addSnapshot(blob);
      void processSnapshot(snap);
    } else {
      setPendingCrop(blob);
    }
  }, [addSnapshot, addToast, camera, mode, processSnapshot]);

  // File-drop fallback: same pipeline, different blob source.
  const onFileSelect = useCallback(
    (file: File): void => {
      if (!file.type.startsWith('image/')) {
        addToast({
          tone: 'alert',
          title: 'Falscher Dateityp',
          body: 'Nur JPEG / PNG / WebP zulässig.',
        });
        return;
      }
      if (mode === 'kyc') {
        const snap = addSnapshot(file);
        void processSnapshot(snap);
      } else {
        setPendingCrop(file);
      }
    },
    [addSnapshot, addToast, mode, processSnapshot],
  );

  // CropStudio commit — push the compressed Blob through the same pipeline
  // as the originals. The metadata (final size / quality) is logged via toast
  // so the operator can confirm the WebP shrink worked.
  const onCropResult = useCallback(
    ({
      blob,
      sizeBytes,
      achievedQuality,
    }: { blob: Blob; sizeBytes: number; achievedQuality: number }): void => {
      setPendingCrop(null);
      const snap = addSnapshot(blob);
      void processSnapshot(snap);
      addToast({
        tone: 'success',
        title: 'Foto komprimiert',
        body: `${Math.round(sizeBytes / 1024)} KB · Qualität ${achievedQuality}`,
      });
    },
    [addSnapshot, addToast, processSnapshot],
  );

  const retrySnapshot = useCallback(
    (id: string): void => {
      const snap = snapshots.find((s) => s.id === id);
      if (snap) void processSnapshot(snap);
    },
    [processSnapshot, snapshots],
  );

  const setMode = useCallback(
    (next: Mode): void => {
      const params = new URLSearchParams(searchParams);
      if (next === 'allgemein') params.delete('mode');
      else params.set('mode', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Context summary line.
  const contextLine = useMemo(() => {
    if (mode === 'produkt' && productId) return `Produkt-Foto · ${productId.slice(0, 8)}…`;
    if (mode === 'kyc' && customerId) return `KYC-Dokument · Kunde ${customerId.slice(0, 8)}…`;
    return 'Allgemein — Zuordnung später';
  }, [mode, productId, customerId]);

  // ── Finish action (UX P0) ───────────────────────────────────────────────
  // The capture flow must have a clear END. `finish()` persists nothing extra
  // (every snapshot is already saved server-side once it reaches status
  // 'done') — it returns the operator to the product sheet (manage mode) or,
  // failing a returnTo, to the Lager list. We surface how many photos are
  // saved-but-still-uploading so the operator doesn't leave mid-upload by
  // mistake.
  const savedCount = useMemo(
    () => snapshots.filter((s) => s.status === 'done').length,
    [snapshots],
  );
  const pendingCount = useMemo(
    () =>
      snapshots.filter(
        (s) => s.status === 'queued' || s.status === 'uploading' || s.status === 'registering',
      ).length,
    [snapshots],
  );

  const finish = useCallback((): void => {
    if (pendingCount > 0) {
      addToast({
        tone: 'info',
        title: 'Uploads noch aktiv',
        body: `${pendingCount} Foto(s) werden noch hochgeladen — bitte kurz warten.`,
      });
      return;
    }
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    if (mode === 'produkt' && productId) {
      navigate(`/lager?produkt=${encodeURIComponent(productId)}`);
      return;
    }
    navigate('/lager');
  }, [addToast, mode, navigate, pendingCount, productId, returnTo]);

  // KYC mode keeps its own binding flow + back-link; the product/orphan flow
  // gets the explicit finish CTA.
  const showFinish = mode !== 'kyc';

  return (
    <section
      aria-label="Foto-Werkstatt"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
      }}
    >
      {/* Round-trip back link — lands on the SAME product sheet (no dead-end). */}
      {returnTo && (
        <button
          type="button"
          onClick={() => navigate(returnTo)}
          className="w14-smallcaps"
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            color: 'var(--w14-ink-aged)',
            cursor: 'pointer',
            padding: '6px 12px',
            fontSize: '0.78rem',
            letterSpacing: '0.06em',
          }}
        >
          ← Zurück zum Produkt
        </button>
      )}

      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Seal size="sm" tone="ink" label="◎" />
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
            }}
          >
            Foto-Werkstatt
          </h1>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: '0.78rem' }}
          >
            {contextLine}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <ModeChip
              active={mode === 'allgemein'}
              label="Allgemein"
              onClick={() => setMode('allgemein')}
            />
            <ModeChip
              active={mode === 'produkt'}
              label="Produkt"
              onClick={() => setMode('produkt')}
              disabled={mode !== 'produkt' && !productId}
              disabledReason="Aus Lager öffnen, um ein Produkt zu binden"
            />
            <ModeChip
              active={mode === 'kyc'}
              label="KYC-Dokument"
              onClick={() => setMode('kyc')}
              disabled={mode !== 'kyc' && !customerId}
              disabledReason="Aus Kunden öffnen, um einen Kunden zu binden"
            />
          </div>
          {showFinish && (
            <Button variant="primary" size="md" onClick={finish} disabled={pendingCount > 0}>
              {pendingCount > 0
                ? `Lädt… (${pendingCount})`
                : mode === 'produkt' && (returnTo || productId)
                  ? `Fertig · zum Produkt${savedCount > 0 ? ` (${savedCount})` : ''}`
                  : 'Fertig · Speichern'}
            </Button>
          )}
        </div>
      </header>

      <DiamondRule />

      {/* Body: split view */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(360px, 1fr)',
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left: viewfinder */}
        <Viewfinder
          videoRef={camera.videoRef}
          permission={camera.permission}
          error={camera.error}
          devices={camera.devices}
          activeDeviceId={camera.activeDeviceId}
          onSwitchDevice={(id) => void camera.switchDevice(id)}
          onRequestPermission={() => void camera.requestPermission()}
          onShutter={() => void onShutter()}
        />

        {/* Right: filmstrip + fallback + KYC form */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 0,
          }}
        >
          <UploadDropzone onFile={onFileSelect} />
          {mode === 'produkt' && productId && <ProductGallery productId={productId} />}
          <Filmstrip
            snapshots={snapshots}
            mode={mode}
            onRetry={retrySnapshot}
            onRemove={removeSnapshot}
          />
          {mode === 'kyc' && customerId && (
            <KycDocumentForm
              customerId={customerId}
              readySnapshot={
                snapshots.find((s) => s.status === 'done' && s.r2Key && s.sha256Hex) ?? null
              }
              onBound={(snapId) => updateSnapshot(snapId, { status: 'done' })}
            />
          )}
        </aside>
      </div>

      {/* Crop interception modal (Mandate 1). Mounted at the section root so
          it overlays the entire screen, not just the viewfinder column. */}
      {pendingCrop !== null && (
        <CropStudio
          source={pendingCrop}
          onCancel={() => setPendingCrop(null)}
          onResult={onCropResult}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Viewfinder
// ────────────────────────────────────────────────────────────────────────

function Viewfinder({
  videoRef,
  permission,
  error,
  devices,
  activeDeviceId,
  onSwitchDevice,
  onRequestPermission,
  onShutter,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  permission: ReturnType<typeof useCamera>['permission'];
  error: string | null;
  devices: readonly { deviceId: string; label: string }[];
  activeDeviceId: string | null;
  onSwitchDevice: (id: string) => void;
  onRequestPermission: () => void;
  onShutter: () => void;
}): JSX.Element {
  const live = permission === 'granted';
  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--w14-midnight-vellum, #1c1410)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: live ? 'block' : 'none',
          background: '#000',
        }}
      />

      {!live && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--w14-parchment-2)' }}>
          {permission === 'unknown' || permission === 'pending' ? (
            <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
              Kamera wird vorbereitet…
            </p>
          ) : permission === 'denied' ? (
            <>
              <p
                style={{
                  margin: '0 0 12px',
                  color: 'var(--w14-wax-red)',
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: '1rem',
                }}
              >
                Kamera-Zugriff verweigert.
              </p>
              <p
                style={{
                  margin: '0 0 14px',
                  color: 'var(--w14-parchment-3)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                  fontSize: '0.88rem',
                }}
              >
                {error ?? 'Bitte in den Systemeinstellungen erlauben und erneut versuchen.'}
              </p>
              <Button variant="primary" onClick={onRequestPermission}>
                Erlaubnis erneut anfragen
              </Button>
            </>
          ) : (
            <>
              <p
                style={{
                  margin: '0 0 12px',
                  color: 'var(--w14-parchment-3)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                }}
              >
                {error ?? 'Keine Kamera erkannt.'}
              </p>
              <p
                style={{
                  margin: 0,
                  color: 'var(--w14-parchment-3)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                  fontSize: '0.85rem',
                }}
              >
                Datei rechts ablegen oder auswählen.
              </p>
            </>
          )}
        </div>
      )}

      {/* Controls — only when live */}
      {live && (
        <>
          {/* Camera switcher — always shown so the operator can confirm/choose
              which camera (the choice is remembered for next time). */}
          {devices.length >= 1 && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(16, 18, 22, 0.82)',
                borderRadius: 'var(--w14-radius-button)',
                padding: '5px 10px',
                border: '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(2px)',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>
                📷
              </span>
              <select
                value={activeDeviceId ?? ''}
                onChange={(ev) => onSwitchDevice(ev.target.value)}
                title="Kamera auswählen"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontFamily: 'var(--w14-font-body)',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  maxWidth: 220,
                }}
              >
                {devices.map((d) => (
                  <option
                    key={d.deviceId}
                    value={d.deviceId}
                    style={{ background: '#16181c', color: '#fff' }}
                  >
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Shutter */}
          <button
            type="button"
            onClick={onShutter}
            aria-label="Auslösen"
            style={{
              position: 'absolute',
              bottom: 28,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'var(--w14-gold)',
              border: '4px solid var(--w14-parchment-1)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.55), inset 0 0 0 2px var(--w14-gold)',
              cursor: 'pointer',
              transition: 'transform var(--w14-dur-short) var(--w14-ease-curator)',
            }}
            onMouseDown={(ev) => {
              (ev.currentTarget as HTMLButtonElement).style.transform =
                'translateX(-50%) scale(0.92)';
            }}
            onMouseUp={(ev) => {
              (ev.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%)';
            }}
            onMouseLeave={(ev) => {
              (ev.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%)';
            }}
          />
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Filmstrip
// ────────────────────────────────────────────────────────────────────────

function Filmstrip({
  snapshots,
  mode,
  onRetry,
  onRemove,
}: {
  snapshots: readonly Snapshot[];
  mode: Mode;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-aged)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          Aufnahmen
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.72rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {snapshots.length}
        </span>
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 10,
        }}
      >
        {snapshots.length === 0 && (
          <p
            style={{
              gridColumn: '1 / -1',
              margin: 0,
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.88rem',
              textAlign: 'center',
              padding: 14,
            }}
          >
            Noch keine Aufnahmen.
          </p>
        )}
        {snapshots.map((s) => (
          <FilmstripCell key={s.id} snap={s} mode={mode} onRetry={onRetry} onRemove={onRemove} />
        ))}
      </div>
    </ParchmentCard>
  );
}

function FilmstripCell({
  snap,
  mode,
  onRetry,
  onRemove,
}: {
  snap: Snapshot;
  mode: Mode;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const statusLabel: Record<SnapshotStatus, string> = {
    queued: 'wartet…',
    uploading: 'lädt hoch…',
    registering: 'registriert…',
    done: mode === 'kyc' ? 'bereit für KYC' : '✓ gespeichert',
    failed: 'fehlgeschlagen',
  };
  const statusColor: Record<SnapshotStatus, string> = {
    queued: 'var(--w14-ink-faded)',
    uploading: 'var(--w14-ink-aged)',
    registering: 'var(--w14-ink-aged)',
    done: 'var(--w14-gold)',
    failed: 'var(--w14-wax-red)',
  };

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '4 / 3',
        background: '#000',
        border: `1px solid ${snap.status === 'failed' ? 'var(--w14-wax-red)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-card)',
        overflow: 'hidden',
      }}
    >
      <img
        src={snap.previewUrl}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: snap.status === 'failed' ? 0.55 : 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '4px 6px',
          background: 'rgba(20, 14, 10, 0.82)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span
          className="w14-smallcaps"
          style={{ color: statusColor[snap.status], fontSize: '0.66rem', letterSpacing: '0.08em' }}
        >
          {statusLabel[snap.status]}
        </span>
        {snap.status === 'failed' && (
          <button
            type="button"
            onClick={() => onRetry(snap.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--w14-gold)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.7rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            erneut
          </button>
        )}
      </div>
      {snap.status === 'done' && (
        <button
          type="button"
          onClick={() => onRemove(snap.id)}
          aria-label="Entfernen"
          title="Entfernen"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            background: 'rgba(20, 14, 10, 0.82)',
            border: '1px solid var(--w14-gold)',
            borderRadius: '50%',
            color: 'var(--w14-gold)',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.78rem',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Product gallery — ALL of a product's saved photos + primary picker
// ────────────────────────────────────────────────────────────────────────

/**
 * The professional gallery the operator manages per product:
 *   • shows EVERY saved photo (not just this session's captures) as thumbnails,
 *   • highlights the current Hauptbild (primary),
 *   • lets the operator promote any photo to Hauptbild via
 *     `photosApi.setPrimary` → PATCH /api/photos/:id/primary.
 *
 * The primary is the ONE image the Verkauf/Kasse catalog tile shows and the
 * storefront gallery leads with; the others ride along for the website gallery.
 * On a successful promotion we invalidate both the product-photos query (so the
 * highlight moves) and the products list (so the catalog thumb updates).
 *
 * Graceful degradation: if the set-primary endpoint isn't deployed yet the
 * backend answers 404/501 — we surface a calm German hint instead of a crash,
 * and the upload + gallery still work (the FIRST photo is auto-primary server-
 * side, so a product always has a sensible catalog image regardless).
 */
function ProductGallery({ productId }: { productId: string }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const photosQuery = useQuery({
    queryKey: ['products', productId, 'photos'],
    queryFn: () => photosApi.listForProduct(api, productId),
    staleTime: 5_000,
  });
  const photos = photosQuery.data?.items ?? [];

  const setPrimary = useMutation({
    mutationFn: (photoId: string) => photosApi.setPrimary(api, photoId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products', productId, 'photos'] }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
      ]);
      addToast({
        tone: 'success',
        title: 'Hauptbild aktualisiert',
        body: 'Dieses Foto erscheint jetzt in der Kasse und zuerst im Online-Shop.',
      });
    },
    onError: (err) => {
      const notImplemented =
        err instanceof ApiError && (err.code === 'NOT_FOUND' || err.httpStatus === 501);
      addToast({
        tone: 'alert',
        title: 'Hauptbild nicht geändert',
        body: notImplemented
          ? 'Die Hauptbild-Auswahl ist auf diesem Server noch nicht aktiv — bitte später erneut versuchen.'
          : err instanceof ApiError
            ? err.message
            : 'Verbindung gestört — bitte erneut versuchen.',
      });
    },
  });

  return (
    <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-aged)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          Galerie · gespeicherte Fotos
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.72rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {photos.length}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--w14-ink-faded)' }}>
        Das Hauptbild erscheint in der Kasse und zuerst im Online-Shop. Tippen Sie auf „Als
        Hauptbild festlegen“, um es zu wechseln.
      </p>

      {photosQuery.isLoading && (
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.84rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          Fotos werden geladen…
        </p>
      )}

      {photosQuery.isSuccess && photos.length === 0 && (
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.84rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          Noch keine gespeicherten Fotos — nehmen Sie links das erste auf.
        </p>
      )}

      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
            gap: 10,
          }}
        >
          {photos.map((p) => (
            <GalleryCell
              key={p.id}
              photo={p}
              busy={setPrimary.isPending && setPrimary.variables === p.id}
              disabled={setPrimary.isPending}
              onSetPrimary={() => setPrimary.mutate(p.id)}
            />
          ))}
        </div>
      )}
    </ParchmentCard>
  );
}

function GalleryCell({
  photo,
  busy,
  disabled,
  onSetPrimary,
}: {
  photo: PhotoRow;
  busy: boolean;
  disabled: boolean;
  onSetPrimary: () => void;
}): JSX.Element {
  const imgSrc = photo.thumbUrl ?? photo.publicUrl ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          position: 'relative',
          aspectRatio: '1 / 1',
          borderRadius: 'var(--w14-radius-card)',
          overflow: 'hidden',
          border: photo.isPrimary ? '2px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-3)',
        }}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={photo.altTextDe ?? 'Produktfoto'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
        {photo.isPrimary && (
          <span
            className="w14-smallcaps"
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              background: 'rgba(20,14,10,0.82)',
              color: 'var(--w14-gold)',
              fontSize: '0.6rem',
              letterSpacing: '0.06em',
              padding: '2px 6px',
              borderRadius: 'var(--w14-radius-button)',
            }}
          >
            ★ Hauptbild
          </span>
        )}
      </div>
      {photo.isPrimary ? (
        <span
          className="w14-smallcaps"
          style={{
            textAlign: 'center',
            color: 'var(--w14-gold)',
            fontSize: '0.66rem',
            letterSpacing: '0.06em',
            padding: '4px 0',
          }}
        >
          aktuelles Hauptbild
        </span>
      ) : (
        <button
          type="button"
          onClick={onSetPrimary}
          disabled={disabled}
          className="w14-smallcaps"
          style={{
            background: 'transparent',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            color: 'var(--w14-ink-aged)',
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.66rem',
            letterSpacing: '0.05em',
            padding: '5px 4px',
            cursor: disabled ? 'wait' : 'pointer',
            opacity: disabled && !busy ? 0.5 : 1,
          }}
        >
          {busy ? 'wird gesetzt…' : 'Als Hauptbild festlegen'}
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Upload dropzone (fallback)
// ────────────────────────────────────────────────────────────────────────

function UploadDropzone({ onFile }: { onFile: (file: File) => void }): JSX.Element {
  const [dragOver, setDragOver] = useState<boolean>(false);

  return (
    <label
      onDragOver={(ev) => {
        ev.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setDragOver(false);
        const file = ev.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px 10px',
        background: dragOver ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
        border: `2px dashed ${dragOver ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-card)',
        cursor: 'pointer',
        transition: 'background-color var(--w14-dur-short), border-color var(--w14-dur-short)',
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(ev) => {
          const files = Array.from(ev.target.files ?? []);
          files.forEach(onFile);
          ev.target.value = '';
        }}
        style={{ display: 'none' }}
      />
      <span
        className="w14-smallcaps"
        style={{
          color: dragOver ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          letterSpacing: '0.08em',
          fontSize: '0.82rem',
        }}
      >
        ◇ Datei hier ablegen oder klicken (JPG / PNG / WEBP)
      </span>
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────────
// KYC document form (mode=kyc, closes #I-47)
// ────────────────────────────────────────────────────────────────────────

function KycDocumentForm({
  customerId,
  readySnapshot,
  onBound,
}: {
  customerId: string;
  readySnapshot: Snapshot | null;
  onBound: (snapId: string) => void;
}): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const [documentType, setDocumentType] = useState<KycDocumentType>('PERSONALAUSWEIS');
  const [issuingCountry, setIssuingCountry] = useState<string>('DE');
  const [issuingAuthority, setIssuingAuthority] = useState<string>('');
  const [documentNumber, setDocumentNumber] = useState<string>('');
  const [issuedOn, setIssuedOn] = useState<string>('');
  const [expiresOn, setExpiresOn] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    readySnapshot !== null &&
    readySnapshot.r2Key !== undefined &&
    readySnapshot.sha256Hex !== undefined &&
    documentNumber.trim().length > 0 &&
    /^[A-Z]{2}$/.test(issuingCountry) &&
    /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) &&
    !submitting;

  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit || !readySnapshot?.r2Key || !readySnapshot.sha256Hex) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        documentType,
        issuingCountryIso2: issuingCountry,
        documentNumber: documentNumber.trim(),
        expiresOn,
        r2Key: readySnapshot.r2Key,
        sha256Hex: readySnapshot.sha256Hex,
        ...(issuingAuthority.trim().length > 0
          ? { issuingAuthority: issuingAuthority.trim() }
          : {}),
        ...(issuedOn.length > 0 ? { issuedOn } : {}),
      };
      await customersApi.addKycDocument(api, customerId, body);
      addToast({
        tone: 'success',
        title: 'KYC-Dokument gespeichert',
        body: `${documentType} · gültig bis ${expiresOn}`,
      });
      onBound(readySnapshot.id);
      // Reset minimal form so the operator can capture another doc.
      setDocumentNumber('');
      setIssuedOn('');
      setExpiresOn('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else setError(err.message);
      } else {
        setError('Verbindung gestört — bitte erneut versuchen.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    addToast,
    api,
    canSubmit,
    customerId,
    documentNumber,
    documentType,
    expiresOn,
    issuedOn,
    issuingAuthority,
    issuingCountry,
    onBound,
    readySnapshot,
  ]);

  return (
    <ParchmentCard padding="md" style={{ background: 'var(--w14-parchment-2)' }}>
      <DiamondRule label="KYC-Dokument binden" />
      <p
        style={{
          margin: '4px 0 12px',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.82rem',
          color: readySnapshot ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
        }}
      >
        {readySnapshot
          ? '✓ Aufnahme bereit — Details ausfüllen + bestätigen.'
          : 'Bitte zuerst Ausweis fotografieren / hochladen.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SelectField
          label="Dokument-Typ"
          value={documentType}
          options={KYC_DOC_OPTIONS}
          onChange={setDocumentType}
        />
        <TextField
          label="Ausstellerland (ISO)"
          value={issuingCountry}
          onChange={(v) => setIssuingCountry(v.toUpperCase().slice(0, 2))}
          mono
        />
        <TextField
          label="Dokumentnummer *"
          value={documentNumber}
          onChange={setDocumentNumber}
          mono
          colSpan={2}
        />
        <TextField
          label="Ausgestellt von (optional)"
          value={issuingAuthority}
          onChange={setIssuingAuthority}
          colSpan={2}
        />
        <TextField
          label="Ausgestellt am (TT-MM-JJJJ)"
          value={issuedOn}
          onChange={setIssuedOn}
          placeholder="2020-01-15"
          mono
        />
        <TextField
          label="Gültig bis (JJJJ-MM-TT) *"
          value={expiresOn}
          onChange={setExpiresOn}
          placeholder="2030-01-15"
          mono
        />
      </div>

      {error && (
        <p
          role="alert"
          style={{ color: 'var(--w14-wax-red)', margin: '12px 0 0', fontSize: '0.88rem' }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Speichert…' : 'KYC-Dokument speichern'}
        </Button>
      </div>
    </ParchmentCard>
  );
}

function TextField({
  label,
  value,
  onChange,
  mono = false,
  placeholder,
  colSpan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
  colSpan?: number;
}): JSX.Element {
  const style: React.CSSProperties = colSpan ? { gridColumn: `span ${colSpan}` } : {};
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.7rem', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '1px solid var(--w14-rule)',
          background: 'transparent',
          padding: '4px',
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
          fontSize: '0.9rem',
          color: 'var(--w14-ink)',
        }}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.7rem', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(ev) => onChange(ev.target.value as T)}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '1px solid var(--w14-rule)',
          background: 'transparent',
          padding: '4px',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.9rem',
          color: 'var(--w14-ink)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Mode chip
// ────────────────────────────────────────────────────────────────────────

function ModeChip({
  active,
  label,
  onClick,
  disabled = false,
  disabledReason,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="w14-smallcaps"
      style={{
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.74rem',
        letterSpacing: '0.08em',
        padding: '4px 10px',
        borderRadius: 'var(--w14-radius-button)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}
