/**
 * ErrorBoundary — the Owner Control Desktop's last line of defence.
 *
 * A render throw anywhere in the tree (e.g. `centsToEur` on a non-integer that
 * slipped past the untyped api-client into BridgeDashboard) used to blank the
 * ENTIRE desktop with no recovery. This catches it and degrades to a calm retry
 * panel, so a single bad payload never takes the whole owner cockpit down.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { describeError } from '@warehouse14/i18n-de';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the desktop diagnosable rather than silently blank.
    console.error('control-desktop: render error caught by boundary', error, info.componentStack);
  }

  private readonly retry = (): void => this.setState({ error: null });

  public override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          background: 'var(--w14-parchment, #f4f2ee)',
          color: 'var(--w14-ink, #1a1a1a)',
          fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
        }}
      >
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px' }}>Etwas ist schiefgelaufen</h1>
          <p style={{ color: 'var(--w14-ink-faded, #777)', margin: '0 0 4px' }}>
            Die Owner-Ansicht konnte nicht angezeigt werden. Ihre Daten sind sicher.
          </p>
          <pre
            style={{
              fontSize: '0.8rem',
              color: 'var(--w14-wax-red, #b3261e)',
              whiteSpace: 'pre-wrap',
              margin: '12px 0 20px',
            }}
          >
            {describeError(error)}
          </pre>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button type="button" onClick={this.retry} style={btn(true)}>
              Erneut versuchen
            </button>
            <button type="button" onClick={() => window.location.reload()} style={btn(false)}>
              Neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid var(--w14-rule, #d8d2c6)',
    background: primary ? 'var(--w14-ink, #1a1a1a)' : 'transparent',
    color: primary ? 'var(--w14-parchment, #fff)' : 'var(--w14-ink, #1a1a1a)',
    fontSize: '0.95rem',
    cursor: 'pointer',
  };
}
