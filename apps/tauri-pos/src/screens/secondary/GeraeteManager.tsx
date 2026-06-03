/**
 * Gerätemanager — Hardware & Kasse tab inside Einstellungen.
 *
 * Four sections, each with: form fields → save (Zustand + localStorage) →
 * test-connection button (calls the Rust bridge) → status badge.
 *
 *   1. Thermal Printer (ESC/POS)         — IP + port + test + print test receipt
 *   2. A4 Printer (system queue)         — dropdown of OS printers + print test page
 *   3. ZVT Card Terminal                 — IP + port + check connection
 *   4. TSE (Fiskaly Cloud)               — TSS-ID + Client-ID + API key + status
 *
 * Persistence: in-memory Zustand → localStorage → (future) PATCH
 * /api/system-settings. The API sync lives in Phase 1.5 backlog;
 * V1 ships local-only persistence which is sufficient for a single
 * shop machine and keeps the operator from getting blocked by the network.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { HardwareStatusBadge } from '../../components/hardware/HardwareStatusBadge.js';
import {
  type LabelConfig,
  type SystemPrinter,
  type ThermalReceiptData,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  labelClient,
  systemClient,
  thermalClient,
  tseClient,
  zvtClient,
} from '../../lib/hardware-client.js';
import {
  type LabelPrinterConfig,
  type ThermalConfig,
  type TseFiskalyConfig,
  type ZvtTerminalConfig,
  useHardwareStore,
} from '../../state/hardware-store.js';
import { useToastStore } from '../../state/toast-store.js';

export function GeraeteManager(): JSX.Element {
  const hydrate = useHardwareStore((s) => s.hydrateFromLocal);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <section
      aria-label="Hardware & Kasse"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
        overflow: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Seal size="sm" tone="ink" label="◊" />
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
            }}
          >
            Hardware & Kasse
          </h1>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: '0.78rem' }}
          >
            Drucker · Karten-Terminal · TSE
          </span>
        </div>
        {!isRunningInTauri() && (
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-wax-red)', fontSize: '0.78rem' }}
          >
            Browser-Modus — Aktionen sind deaktiviert
          </span>
        )}
      </header>
      <DiamondRule />

      <ThermalSection />
      <A4Section />
      <LabelSection />
      <ZvtSection />
      <TseSection />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 1 — Thermal Printer (ESC/POS)
// ════════════════════════════════════════════════════════════════════════

function ThermalSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.thermal);
  const setThermal = useHardwareStore((s) => s.setThermal);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState<'test' | 'print' | null>(null);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));

  // Re-hydrate the drafts if the store changes externally.
  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const save = useCallback(
    (patch: Partial<ThermalConfig>) => {
      setThermal(patch);
    },
    [setThermal],
  );

  const testConnection = useCallback(async () => {
    setBusy('test');
    try {
      // The thermal "test" is just a TCP probe — same pattern as ZVT.
      const ok = await zvtClient.check({ ip: cfg.ip, port: cfg.port });
      save({ lastReachable: ok, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Drucker erreichbar' : 'Drucker offline',
        body: `${cfg.ip}:${cfg.port}`,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Verbindungsfehler',
        body: isHardwareError(err) ? describeHardwareError(err) : 'Unbekannter Fehler',
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, cfg.ip, cfg.port, save]);

  const printTestReceipt = useCallback(async () => {
    setBusy('print');
    try {
      await thermalClient.print({ ip: cfg.ip, port: cfg.port }, buildTestReceipt());
      addToast({
        tone: 'success',
        title: 'Testbeleg gesendet',
        body: 'Bitte Drucker kontrollieren.',
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Druck fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [addToast, cfg.ip, cfg.port]);

  return (
    <Card title="Bondrucker (ESC/POS)">
      <Row>
        <LabelledInput
          label="IP-Adresse"
          value={ipDraft}
          onChange={setIpDraft}
          onBlur={() => save({ ip: ipDraft.trim() })}
          placeholder="192.168.1.50"
        />
        <LabelledInput
          label="Port"
          value={portDraft}
          onChange={setPortDraft}
          onBlur={() => save({ port: Number(portDraft) || 9100 })}
          placeholder="9100"
          width={90}
        />
      </Row>
      <Row>
        <Button
          variant="ghost"
          onClick={() => void testConnection()}
          disabled={busy !== null || !cfg.ip}
        >
          {busy === 'test' ? 'Prüft…' : 'Verbindung prüfen'}
        </Button>
        <Button
          variant="primary"
          onClick={() => void printTestReceipt()}
          disabled={busy !== null || !cfg.ip}
        >
          {busy === 'print' ? 'Druckt…' : 'Testbeleg drucken'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht geprüft'
              : cfg.lastReachable
                ? 'Drucker online'
                : 'Drucker offline'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2 — A4 Printer (system queue)
// ════════════════════════════════════════════════════════════════════════

function A4Section(): JSX.Element {
  const printerName = useHardwareStore((s) => s.config.a4.printerName);
  const setA4 = useHardwareStore((s) => s.setA4);
  const addToast = useToastStore((s) => s.addToast);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isRunningInTauri()) return;
    setRefreshing(true);
    try {
      const list = await systemClient.listPrinters();
      setPrinters(list);
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Drucker konnten nicht ermittelt werden',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    } finally {
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card title="A4-Drucker (Rechnungen)">
      <Row>
        <label
          htmlFor="a4-printer"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 110 }}
        >
          System-Drucker
        </label>
        <select
          id="a4-printer"
          value={printerName}
          onChange={(e) => setA4({ printerName: e.target.value })}
          style={{
            flex: 1,
            padding: '6px 10px',
            fontFamily: 'var(--w14-font-display)',
            backgroundColor: 'var(--w14-parchment-1)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 4,
          }}
        >
          <option value="">— bitte wählen —</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.status})
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Lädt…' : 'Aktualisieren'}
        </Button>
      </Row>
      <Row>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem' }}>
          Liste stammt von <code>lpstat -p</code>. PDFs gehen via <code>lpr -P</code>.
        </span>
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2b — Label printer (ZPL / ESC-POS)
// ════════════════════════════════════════════════════════════════════════

function LabelSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.label);
  const setLabel = useHardwareStore((s) => s.setLabel);
  const addToast = useToastStore((s) => s.addToast);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const refresh = useCallback(async () => {
    if (!isRunningInTauri()) return;
    try {
      setPrinters(await systemClient.listPrinters());
    } catch {
      // Non-fatal — the operator can still type a name (n/a for label rolls).
    }
  }, []);
  useEffect(() => {
    if (cfg.mode === 'system') void refresh();
  }, [cfg.mode, refresh]);

  const save = useCallback((patch: Partial<LabelPrinterConfig>) => setLabel(patch), [setLabel]);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const config: LabelConfig = {
        mode: cfg.mode,
        ip: cfg.ip || undefined,
        port: cfg.port,
        printerName: cfg.printerName || undefined,
        printerType: cfg.printerType,
      };
      await labelClient.test(config);
      save({ lastReachable: true, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: 'success',
        title: 'Testetikett gesendet',
        body: 'Bitte Etikettendrucker kontrollieren.',
      });
    } catch (err) {
      save({ lastReachable: false, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: 'alert',
        title: 'Etikettendruck fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, save, cfg.mode, cfg.ip, cfg.port, cfg.printerName, cfg.printerType]);

  const testDisabled =
    busy || (cfg.mode === 'system' ? cfg.printerName.length === 0 : cfg.ip.length === 0);

  return (
    <Card title="Etikettendrucker (ZPL / ESC-POS)">
      <Row>
        <label
          htmlFor="label-mode"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 110 }}
        >
          Modus
        </label>
        <select
          id="label-mode"
          value={cfg.mode}
          onChange={(e) => save({ mode: e.target.value as LabelPrinterConfig['mode'] })}
          style={selectStyle()}
        >
          <option value="system">System-Warteschlange (CUPS)</option>
          <option value="tcp">Netzwerk (TCP 9100)</option>
        </select>
        <label
          htmlFor="label-type"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 70 }}
        >
          Format
        </label>
        <select
          id="label-type"
          value={cfg.printerType}
          onChange={(e) =>
            save({ printerType: e.target.value as LabelPrinterConfig['printerType'] })
          }
          style={selectStyle(140)}
        >
          <option value="ZPL">ZPL (Zebra)</option>
          <option value="ESCPOS">ESC/POS</option>
        </select>
      </Row>

      {cfg.mode === 'system' ? (
        <Row>
          <label
            htmlFor="label-printer"
            className="w14-smallcaps"
            style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 110 }}
          >
            System-Drucker
          </label>
          <select
            id="label-printer"
            value={cfg.printerName}
            onChange={(e) => save({ printerName: e.target.value })}
            style={selectStyle()}
          >
            <option value="">— bitte wählen —</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.status})
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={() => void refresh()}>
            Aktualisieren
          </Button>
        </Row>
      ) : (
        <Row>
          <LabelledInput
            label="IP-Adresse"
            value={ipDraft}
            onChange={setIpDraft}
            onBlur={() => save({ ip: ipDraft.trim() })}
            placeholder="192.168.1.70"
          />
          <LabelledInput
            label="Port"
            value={portDraft}
            onChange={setPortDraft}
            onBlur={() => save({ port: Number(portDraft) || 9100 })}
            placeholder="9100"
            width={90}
          />
        </Row>
      )}

      <Row>
        <Button variant="primary" onClick={() => void test()} disabled={testDisabled}>
          {busy ? 'Druckt…' : 'Testetikett drucken'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht geprüft'
              : cfg.lastReachable
                ? 'Drucker bereit'
                : 'Druck fehlgeschlagen'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3 — ZVT Card Terminal
// ════════════════════════════════════════════════════════════════════════

function ZvtSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.zvt);
  const setZvt = useHardwareStore((s) => s.setZvt);
  const addToast = useToastStore((s) => s.addToast);
  const [ipDraft, setIpDraft] = useState(cfg.ip);
  const [portDraft, setPortDraft] = useState(String(cfg.port));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIpDraft(cfg.ip);
    setPortDraft(String(cfg.port));
  }, [cfg.ip, cfg.port]);

  const save = useCallback((patch: Partial<ZvtTerminalConfig>) => setZvt(patch), [setZvt]);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await zvtClient.check({ ip: cfg.ip, port: cfg.port });
      save({ lastReachable: ok, lastCheckedAt: new Date().toISOString() });
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Terminal erreichbar' : 'Terminal offline',
        body: `${cfg.ip}:${cfg.port}`,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'ZVT-Verbindungsfehler',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, cfg.ip, cfg.port, save]);

  return (
    <Card title="Kartenterminal (ZVT)">
      <Row>
        <LabelledInput
          label="IP-Adresse"
          value={ipDraft}
          onChange={setIpDraft}
          onBlur={() => save({ ip: ipDraft.trim() })}
          placeholder="192.168.1.60"
        />
        <LabelledInput
          label="Port"
          value={portDraft}
          onChange={setPortDraft}
          onBlur={() => save({ port: Number(portDraft) || 20007 })}
          placeholder="20007"
          width={90}
        />
      </Row>
      <Row>
        <Button variant="ghost" onClick={() => void check()} disabled={busy || !cfg.ip}>
          {busy ? 'Prüft…' : 'Verbindung prüfen'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'offline'}
          label={
            cfg.lastReachable === null
              ? 'Noch nicht geprüft'
              : cfg.lastReachable
                ? 'Terminal bereit'
                : 'Terminal offline'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 4 — TSE (Fiskaly Cloud)
// ════════════════════════════════════════════════════════════════════════

function TseSection(): JSX.Element {
  const cfg = useHardwareStore((s) => s.config.tse);
  const setTse = useHardwareStore((s) => s.setTse);
  const addToast = useToastStore((s) => s.addToast);
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tssDraft, setTssDraft] = useState(cfg.tssId);
  const [clientDraft, setClientDraft] = useState(cfg.clientId);
  // Secret drafts are transient: typed once, pushed to the OS keychain, then
  // cleared. They never enter the store or localStorage.
  const [keyDraft, setKeyDraft] = useState('');
  const [secretDraft, setSecretDraft] = useState('');

  const save = useCallback((patch: Partial<TseFiskalyConfig>) => setTse(patch), [setTse]);

  useEffect(() => {
    setTssDraft(cfg.tssId);
    setClientDraft(cfg.clientId);
  }, [cfg.tssId, cfg.clientId]);

  // Reconcile the "stored?" hint with the real OS keychain on mount.
  useEffect(() => {
    let alive = true;
    void tseClient
      .credentialsPresent()
      .then((present) => {
        if (alive) save({ credentialsStored: present });
      })
      .catch(() => {
        /* keychain unavailable (browser mode) — leave the hint untouched */
      });
    return () => {
      alive = false;
    };
  }, [save]);

  const storeCredentials = useCallback(async () => {
    const key = keyDraft.trim();
    const secret = secretDraft.trim();
    if (!key || !secret) {
      addToast({
        tone: 'alert',
        title: 'TSE-Zugangsdaten unvollständig',
        body: 'API-Key und API-Secret sind beide erforderlich.',
      });
      return;
    }
    try {
      await tseClient.storeCredentials(key, secret);
      save({ credentialsStored: true });
      setKeyDraft('');
      setSecretDraft('');
      setEditingKey(false);
      addToast({
        tone: 'success',
        title: 'TSE-Schlüssel gespeichert',
        body: 'Sicher im OS-Schlüsselbund hinterlegt — nicht im Browserspeicher.',
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    }
  }, [addToast, keyDraft, secretDraft, save]);

  const clearCredentials = useCallback(async () => {
    try {
      await tseClient.clearCredentials();
      save({ credentialsStored: false });
      addToast({
        tone: 'success',
        title: 'TSE-Schlüssel gelöscht',
        body: 'Aus dem OS-Schlüsselbund entfernt.',
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Löschen fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    }
  }, [addToast, save]);

  const checkStatus = useCallback(async () => {
    setBusy(true);
    try {
      // Secrets are hydrated inside Rust from the keychain — not sent here.
      const s = await tseClient.status({ tssId: cfg.tssId, clientId: cfg.clientId });
      save({
        lastReachable: s.reachable,
        lastCheckedAt: s.lastCheckedAt,
        ...(s.reachable ? { lastSyncAt: s.lastCheckedAt } : {}),
      });
      addToast({
        tone: s.reachable ? 'success' : 'alert',
        title: s.reachable ? 'TSE erreichbar' : 'TSE nicht erreichbar',
        body: s.message,
      });
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'TSE-Statusabfrage fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [addToast, cfg.tssId, cfg.clientId, save]);

  return (
    <Card title="TSE (Technische Sicherheitseinrichtung)">
      <Row>
        <LabelledInput
          label="Fiskaly TSS-ID"
          value={tssDraft}
          onChange={setTssDraft}
          onBlur={() => save({ tssId: tssDraft.trim() })}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Row>
      <Row>
        <LabelledInput
          label="Client-ID"
          value={clientDraft}
          onChange={setClientDraft}
          onBlur={() => save({ clientId: clientDraft.trim() })}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Row>
      <Row>
        <span
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 110 }}
        >
          API-Key
        </span>
        {editingKey ? (
          <>
            <input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="API-Key"
              type="password"
              autoComplete="off"
              style={inputStyle()}
            />
            <input
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              placeholder="API-Secret"
              type="password"
              autoComplete="off"
              style={inputStyle()}
            />
            <Button variant="primary" onClick={() => void storeCredentials()}>
              Speichern
            </Button>
          </>
        ) : (
          <>
            <span
              style={{ flex: 1, fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink-faded)' }}
            >
              {cfg.credentialsStored ? '•••••••••••• (im Schlüsselbund)' : '— nicht gesetzt —'}
            </span>
            <Button variant="ghost" onClick={() => setEditingKey(true)}>
              {cfg.credentialsStored ? 'Ändern' : 'Hinterlegen'}
            </Button>
            {cfg.credentialsStored ? (
              <Button variant="ghost" onClick={() => void clearCredentials()}>
                Löschen
              </Button>
            ) : null}
          </>
        )}
      </Row>
      <Row>
        <Button
          variant="ghost"
          onClick={() => void checkStatus()}
          disabled={busy || !cfg.tssId || !cfg.credentialsStored}
        >
          {busy ? 'Prüft…' : 'TSE-Verbindung prüfen'}
        </Button>
        <span style={{ flex: 1 }} />
        <HardwareStatusBadge
          tone={cfg.lastReachable === null ? 'pending' : cfg.lastReachable ? 'online' : 'error'}
          label={
            cfg.lastReachable === null
              ? 'Nicht konfiguriert'
              : cfg.lastReachable
                ? 'TSE aktiv'
                : 'TSE inaktiv'
          }
          lastCheckedAt={cfg.lastCheckedAt}
        />
      </Row>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Building blocks — kept local; the Hardware tab is a one-off layout.
// ════════════════════════════════════════════════════════════════════════

function Card({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.05rem',
        }}
      >
        {title}
      </h2>
      <DiamondRule />
      {children}
    </ParchmentCard>
  );
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  placeholder?: string;
  width?: number;
}): JSX.Element {
  const id = `cfg-${label}`.replace(/\s+/g, '-').toLowerCase();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label
        htmlFor={id}
        className="w14-smallcaps"
        style={{ letterSpacing: '0.08em', fontSize: '0.78rem', minWidth: 110 }}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        style={inputStyle(width)}
      />
    </span>
  );
}

function inputStyle(width?: number): React.CSSProperties {
  return {
    width: width ?? 220,
    padding: '6px 10px',
    fontFamily: 'var(--w14-font-mono)',
    fontSize: '0.92rem',
    backgroundColor: 'var(--w14-parchment-1)',
    border: '1px solid var(--w14-rule)',
    borderRadius: 4,
  };
}

function selectStyle(width?: number): React.CSSProperties {
  return {
    width: width ?? 240,
    padding: '6px 10px',
    fontFamily: 'var(--w14-font-display)',
    backgroundColor: 'var(--w14-parchment-1)',
    border: '1px solid var(--w14-rule)',
    borderRadius: 4,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function buildTestReceipt(): ThermalReceiptData {
  const now = new Date();
  const printedAt = now.toLocaleString('de-DE');
  return {
    shopName: 'WAREHOUSE 14',
    shopAddress: ['Musterstraße 1', '10115 Berlin'],
    shopVatId: 'DE000000000',
    shopPhone: null,
    receiptLocator: 'TEST-0001',
    printedAt,
    cashierName: 'Test',
    shiftId: null,
    items: [
      {
        name: 'Test-Position',
        quantity: 1,
        unitPriceEur: '1.00',
        lineTotalEur: '1.00',
        vatLabel: '19%',
      },
    ],
    subtotalEur: '0.84',
    vatEur: '0.16',
    totalEur: '1.00',
    paymentMethodLabel: 'Bar',
    cashReceivedEur: '1.00',
    changeEur: '0.00',
    tseSignatureValue: 'TEST-SIG',
    tseSignatureCounter: '0',
    tseTransactionNumber: '0',
    tseQrPayload: 'TEST',
    footerLines: ['Vielen Dank für Ihren Besuch.', 'Dies ist ein Testbeleg — keine Buchung.'],
  };
}
