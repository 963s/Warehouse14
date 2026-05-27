/**
 * HardwareStatusBadge — tiny circular indicator + label for the
 * Gerätemanager sections. Three states:
 *
 *   • online    (gold dot)
 *   • offline   (faded ink dot)
 *   • error     (wax-red dot)
 *
 * No external dependencies — purely brand-token colours.
 */

export type HardwareStatusTone = 'online' | 'offline' | 'error' | 'pending';

export interface HardwareStatusBadgeProps {
  tone: HardwareStatusTone;
  label: string;
  /** Optional ISO timestamp; appended as "· letzter Check 16:43". */
  lastCheckedAt?: string | null;
}

export function HardwareStatusBadge({
  tone,
  label,
  lastCheckedAt,
}: HardwareStatusBadgeProps): JSX.Element {
  const colour =
    tone === 'online'
      ? 'var(--w14-gold)'
      : tone === 'error'
        ? 'var(--w14-wax-red)'
        : tone === 'pending'
          ? 'var(--w14-ink-faded)'
          : 'var(--w14-rule)';

  const since = formatSince(lastCheckedAt ?? null);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.86rem',
        color: 'var(--w14-ink-aged)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: colour,
          boxShadow: `0 0 0 2px var(--w14-parchment-2)`,
        }}
      />
      <span>{label}</span>
      {since && (
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}>
          · letzter Check {since}
        </span>
      )}
    </span>
  );
}

function formatSince(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}
