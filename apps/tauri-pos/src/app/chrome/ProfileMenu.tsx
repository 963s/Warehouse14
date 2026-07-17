/**
 * ProfileMenu — the operator identity anchor in the header, in place of the old
 * "14" seal. Shows the signed-in Google account (portrait, name, email), the
 * server-assigned role, the live session validity, and is the one place to sign
 * out.
 *
 * Two layers, deliberately split:
 *   • ProfileMenuView — PURE. Takes actor/profile/session + handlers as props and
 *     renders the medallion + popover. No hooks, so it renders in isolation (SSR
 *     preview, tests) exactly as it does in the shell.
 *   • ProfileMenu — the container. Wires the session store, the API client, the
 *     router, outside-click / Escape close, and the sign-out.
 *
 * The portrait + name come from the Google sign-in (cached on this device); the
 * email + role come from the session. When a field is not yet known (a PIN
 * session, or before the profile has been delivered) it degrades to initials on
 * a struck-brass medallion and the role alone — never a broken image, never a
 * guess. Colours come from the brand tokens: `--w14-gilt` is the real gold
 * thread (`--w14-gold` is a legacy name for the quiet ink accent, NOT gold).
 */

import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { authPin, type AuthProfile, type SessionActor } from '@warehouse14/api-client';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { clearLocalPin } from '../../lib/local-lock.js';
import { clearSessionToken } from '../../lib/session-token.js';
import { useSessionStore } from '../../state/session-store.js';

function roleLabel(actor: SessionActor): string {
  if (actor.isOwner) return 'Inhaber';
  switch (actor.role) {
    case 'ADMIN':
      return 'Administrator';
    case 'CASHIER':
      return 'Kassierer';
    case 'READONLY':
      return 'Nur Lesen';
    default:
      return actor.role;
  }
}

/** Honest, high-level access scope for the role — the "Berechtigungen" line. */
function scopeLabel(actor: SessionActor): string {
  if (actor.isOwner) return 'Voller Zugriff auf alle Bereiche';
  switch (actor.role) {
    case 'ADMIN':
      return 'Verwaltung, Berichte & Einstellungen';
    case 'CASHIER':
      return 'Kasse, Verkauf & Ankauf';
    case 'READONLY':
      return 'Nur Lesezugriff';
    default:
      return 'Angemeldet';
  }
}

function initialsFrom(name: string | null | undefined, email: string | null | undefined): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (a + b).toUpperCase() || 'W';
  }
  const e = email?.trim();
  if (e) return e[0]!.toUpperCase();
  return 'W';
}

/** "gültig bis 14. August" — the human session horizon, or null if unknown/passed. */
function validUntilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= Date.now()) return null;
  try {
    return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(new Date(t));
  } catch {
    return null;
  }
}

// ── The brass portrait medallion ─────────────────────────────────────────
// A struck-brass disc framing the portrait (or initials), echoing the "14"
// seal it replaces: a bright gilt rim, a fine inner hairline, an inset shadow
// so the metal reads as raised. The brass gradient is intentionally literal
// (like the Zielkarte instruments) — the theme tokens carry the surrounding
// chrome, the medallion carries the gold.
function Medallion({
  size,
  avatarUrl,
  initials,
}: {
  size: number;
  avatarUrl: string | null;
  initials: string;
}): JSX.Element {
  const frame = Math.max(2, Math.round(size * 0.085));
  const ring: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    padding: frame,
    boxSizing: 'border-box',
    // Brushed-brass rim: a warm gilt gradient with a bright top sheen.
    background:
      'radial-gradient(120% 120% at 32% 24%, #f6e2a6 0%, #d8b263 38%, #a3823b 66%, #715321 100%)',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.5) inset, 0 -1px 2px rgba(0,0,0,0.35) inset, 0 1px 3px rgba(28,24,16,0.35), 0 0 0 0.5px rgba(90,66,26,0.7)',
    display: 'grid',
    placeItems: 'stretch',
    flex: '0 0 auto',
  };
  const well: CSSProperties = {
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    // A darker recessed well so the portrait/initials sit BELOW the brass rim.
    background: 'radial-gradient(85% 85% at 50% 38%, #e9dcbf 0%, #cdb789 70%, #a68f5f 100%)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4) inset',
  };
  return (
    <span style={ring} aria-hidden="true">
      <span style={well}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={size}
            height={size}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 600,
              fontSize: Math.round(size * 0.4),
              lineHeight: 1,
              color: '#3a2b12',
              letterSpacing: '0.01em',
            }}
          >
            {initials}
          </span>
        )}
      </span>
    </span>
  );
}

export interface ProfileMenuViewProps {
  actor: SessionActor | null;
  profile: AuthProfile | null;
  sessionExpiresAt: string | null;
  open: boolean;
  signingOut: boolean;
  wrapRef?: React.Ref<HTMLDivElement>;
  onToggle: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}

/** The pure view — renders identically in the shell and in isolation. */
export function ProfileMenuView({
  actor,
  profile,
  sessionExpiresAt,
  open,
  signingOut,
  wrapRef,
  onToggle,
  onSettings,
  onSignOut,
}: ProfileMenuViewProps): JSX.Element {
  const name = profile?.displayName?.trim() || profile?.email?.split('@')[0] || 'Angemeldet';
  const email = profile?.email ?? null;
  const initials = initialsFrom(profile?.displayName, profile?.email);
  const avatarUrl = profile?.avatarUrl ?? null;
  const validUntil = validUntilLabel(sessionExpiresAt);
  const isOwner = actor?.isOwner ?? false;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={actor ? `Profil: ${name}` : 'Profil'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 2,
          borderRadius: '50%',
          lineHeight: 0,
        }}
      >
        <Medallion size={34} avatarUrl={avatarUrl} initials={initials} />
      </button>

      {open && (
        <>
          {/* Caret pointing up to the medallion. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 40,
              left: 10,
              width: 12,
              height: 12,
              background: 'var(--w14-parchment-2)',
              borderTop: '1px solid var(--w14-rule)',
              borderLeft: '1px solid var(--w14-rule)',
              transform: 'rotate(45deg)',
              zIndex: 61,
            }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 46,
              left: 0,
              zIndex: 60,
              width: 288,
              padding: 18,
              lineHeight: 1.4,
              borderRadius: 'var(--w14-radius-card)',
              background: 'var(--w14-parchment-2)',
              border: '1px solid var(--w14-rule)',
              boxShadow: '0 18px 44px rgba(20,16,8,0.28), 0 2px 8px rgba(20,16,8,0.14)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <Medallion size={52} avatarUrl={avatarUrl} initials={initials} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--w14-font-display)',
                    fontWeight: 600,
                    fontSize: '1.08rem',
                    color: 'var(--w14-ink)',
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </div>
                {email && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: '0.82rem',
                      color: 'var(--w14-ink-aged)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {email}
                  </div>
                )}
              </div>
            </div>

            {actor && (
              <div style={{ marginTop: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 11px',
                    borderRadius: 999,
                    fontSize: '0.68rem',
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: isOwner ? '#2a1f0c' : 'var(--w14-ink-aged)',
                    background: isOwner
                      ? 'linear-gradient(180deg, #e7c778, #b8933f)'
                      : 'var(--w14-parchment-3)',
                    border: isOwner ? '1px solid #9a7a34' : '1px solid var(--w14-rule)',
                    boxShadow: isOwner ? '0 1px 0 rgba(255,255,255,0.4) inset' : 'none',
                  }}
                >
                  {roleLabel(actor)}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>
                  {profile?.displayName ? 'mit Google angemeldet' : 'angemeldet'}
                </span>
              </div>
            )}

            <DiamondRule />

            {actor && (
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    fontSize: '0.64rem',
                    letterSpacing: '0.11em',
                    textTransform: 'uppercase',
                    color: 'var(--w14-ink-faded)',
                    fontWeight: 700,
                  }}
                >
                  Berechtigungen
                </span>
                <span style={{ fontSize: '0.86rem', color: 'var(--w14-ink-aged)' }}>
                  {scopeLabel(actor)}
                </span>
              </div>
            )}

            {validUntil && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginBottom: 12,
                  fontSize: '0.74rem',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--w14-gilt)',
                    boxShadow: '0 0 0 2px rgba(163,130,59,0.22)',
                    flex: '0 0 auto',
                  }}
                />
                <span>
                  Sitzung aktiv · gültig bis {validUntil}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <Button variant="ghost" size="sm" onClick={onSettings}>
                Einstellungen
              </Button>
              <Button variant="primary" size="sm" onClick={onSignOut} disabled={signingOut}>
                {signingOut ? 'Wird abgemeldet …' : 'Abmelden'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The wired container used in the header. */
export function ProfileMenu(): JSX.Element {
  const navigate = useNavigate();
  const client = useApiClient();
  const actor = useSessionStore((s) => s.actor);
  const profile = useSessionStore((s) => s.profile);
  const sessionExpiresAt = useSessionStore((s) => s.sessionExpiresAt);
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await authPin.signOut(client);
    } catch {
      // Best-effort: clear locally so the operator is never stranded.
    } finally {
      clearSessionToken();
      clearLocalPin();
      setUnauthenticated();
    }
  }

  return (
    <ProfileMenuView
      actor={actor}
      profile={profile}
      sessionExpiresAt={sessionExpiresAt}
      open={open}
      signingOut={signingOut}
      wrapRef={wrapRef}
      onToggle={() => setOpen((v) => !v)}
      onSettings={() => {
        setOpen(false);
        navigate('/einstellungen');
      }}
      onSignOut={() => void handleSignOut()}
    />
  );
}
