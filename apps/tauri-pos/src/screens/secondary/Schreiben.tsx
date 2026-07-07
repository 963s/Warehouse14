/**
 * Schreiben — an A4 document studio for contracts, invoices and letters.
 *
 * The same idea as the receipt designer, but for a full A4 sheet: the shop logo
 * + identity sit in the header, and every field (recipient, subject, body,
 * signature) is click-to-edit right on the page (WYSIWYG, contentEditable).
 * Pick a template (Ankaufvertrag · Rechnung · Brief · Leeres Blatt) to pre-fill
 * the structure, then type. "Drucken" prints the sheet at true A4.
 *
 * AI assist (gated): "Text verbessern" polishes the body, and a small compose
 * box generates a passage from a short instruction. Both call POST
 * /api/ai/compose; when the Anthropic key isn't set the server replies 503 and
 * we surface the German "KI nicht konfiguriert" message — no crash, and it
 * activates later with no app update.
 *
 * (Distinct from `Dokumente`, which is the uploaded-file archive.)
 */

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

import { resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import { useApiClient } from '../../lib/api-context.js';
import { SHOP_INFO } from '../../lib/shop-info.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

type TemplateKind = 'ankaufvertrag' | 'rechnung' | 'brief' | 'leer';

interface TemplateDef {
  key: TemplateKind;
  label: string;
  betreff: string;
  body: string;
  showSignature: boolean;
}

const TODAY = (): string =>
  new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const TEMPLATES: readonly TemplateDef[] = [
  {
    key: 'ankaufvertrag',
    label: 'Ankaufvertrag',
    betreff: 'Ankaufvertrag',
    body:
      'Zwischen dem oben genannten Geschäft (Ankäufer) und dem unten genannten ' +
      'Verkäufer wird folgender Ankauf vereinbart:\n\n' +
      'Gegenstand:\nGewicht / Feinheit:\nVereinbarter Ankaufspreis:\n\n' +
      'Der Verkäufer versichert, rechtmäßiger Eigentümer des Gegenstands zu sein. ' +
      'Die Identität wurde gemäß Geldwäschegesetz (GwG) anhand eines amtlichen ' +
      'Lichtbildausweises geprüft.\n\nAusweisart / Nummer:',
    showSignature: true,
  },
  {
    key: 'rechnung',
    label: 'Rechnung',
    betreff: 'Rechnung Nr. —',
    body:
      'Sehr geehrte Damen und Herren,\n\nwir berechnen Ihnen wie folgt:\n\n' +
      'Pos.   Bezeichnung                          Menge   Einzelpreis   Gesamt\n' +
      '1                                            1\n\n' +
      'Gesamtbetrag:\n\nDie Ware wurde nach § 25a UStG (Differenzbesteuerung) ' +
      'verkauft; die Umsatzsteuer wird nicht gesondert ausgewiesen.\n\n' +
      'Bitte begleichen Sie den Betrag innerhalb von 14 Tagen.',
    showSignature: false,
  },
  {
    key: 'brief',
    label: 'Brief',
    betreff: '',
    body: 'Sehr geehrte Damen und Herren,\n\n\n\nMit freundlichen Grüßen',
    showSignature: true,
  },
  { key: 'leer', label: 'Leeres Blatt', betreff: '', body: '', showSignature: false },
];

const FALLBACK_TEMPLATE = TEMPLATES[2] as TemplateDef;

const TONES = ['förmlich', 'freundlich', 'bestimmt', 'knapp'] as const;

export function Schreiben(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const actor = useSessionStore((s) => s.actor);
  const { data: shopApi } = useShopInfo();
  const shop = resolveShopInfo(shopApi);

  const empfaengerRef = useRef<HTMLDivElement | null>(null);
  const betreffRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const [template, setTemplate] = useState<TemplateKind>('brief');
  const [tone, setTone] = useState<string>('förmlich');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiBusy, setAiBusy] = useState<false | 'improve' | 'generate'>(false);

  const applyTemplate = (kind: TemplateKind): void => {
    const t = TEMPLATES.find((x) => x.key === kind) ?? FALLBACK_TEMPLATE;
    setTemplate(kind);
    if (betreffRef.current) betreffRef.current.innerText = t.betreff;
    if (bodyRef.current) bodyRef.current.innerText = t.body;
  };

  // Seed the default template once on mount.
  useEffect(() => {
    const t = TEMPLATES.find((x) => x.key === 'brief') ?? FALLBACK_TEMPLATE;
    if (betreffRef.current) betreffRef.current.innerText = t.betreff;
    if (bodyRef.current) bodyRef.current.innerText = t.body;
  }, []);

  const currentDef = TEMPLATES.find((x) => x.key === template) ?? FALLBACK_TEMPLATE;

  const callAi = async (mode: 'improve' | 'generate', text: string): Promise<void> => {
    if (text.trim().length === 0) {
      addToast({ tone: 'info', title: mode === 'improve' ? 'Kein Text' : 'Keine Beschreibung' });
      return;
    }
    setAiBusy(mode);
    try {
      const res = await api.request<{ text: string }>('POST', '/api/ai/compose', {
        mode,
        text,
        tone,
        docKind: currentDef.label,
      });
      if (bodyRef.current) {
        bodyRef.current.innerText =
          mode === 'improve' ? res.text : `${bodyRef.current.innerText}\n${res.text}`.trim();
      }
      if (mode === 'generate') setAiPrompt('');
      addToast({ tone: 'success', title: 'KI-Text übernommen' });
    } catch (err) {
      const msg = err instanceof ApiError ? describeError(err) : 'KI nicht erreichbar.';
      addToast({ tone: 'alert', title: 'KI', body: msg });
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div
      style={{ display: 'flex', height: '100%', minHeight: 0, background: 'var(--w14-parchment)' }}
    >
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .w14-a4, .w14-a4 * { visibility: visible !important; }
        .w14-a4 { position: absolute; left: 0; top: 0; margin: 0 !important; box-shadow: none !important;
                  width: 210mm !important; min-height: 297mm !important; }
        .w14-noprint { display: none !important; }
        .w14-a4 [contenteditable]:empty::before { content: "" !important; }
      }
      .w14-a4 [contenteditable] { outline: none; }
      .w14-a4 [contenteditable]:focus { background: #f4f1ff; border-radius: 3px; }
      .w14-a4 [contenteditable]:empty::before { content: attr(data-ph); color: #b9b3a6; }`}</style>

      {/* ── Controls (no-print) ───────────────────────────────────────────── */}
      <nav
        className="w14-noprint"
        style={{
          width: 280,
          flex: '0 0 auto',
          borderRight: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
          padding: 16,
          overflowY: 'auto',
        }}
      >
        <h1 style={{ margin: '2px 0 4px', fontSize: '1.2rem', fontWeight: 600 }}>Schreiben</h1>
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
          Verträge, Rechnungen und Briefe auf A4. Felder direkt anklicken und schreiben.
        </p>
        <DiamondRule label="Vorlage" />
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {TEMPLATES.map((t) => {
            const active = t.key === template;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t.key)}
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  borderRadius: 'var(--w14-radius-button)',
                  border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                  background: active ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-1)',
                  color: active ? 'var(--w14-ink)' : 'var(--w14-ink-aged)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 18 }}>
          <DiamondRule label="KI-Assistent" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
            {TONES.map((tn) => (
              <button
                key={tn}
                type="button"
                onClick={() => setTone(tn)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  border: `1px solid ${tone === tn ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
                  background: tone === tn ? 'var(--w14-accent)' : 'transparent',
                  color: tone === tn ? 'var(--w14-accent-ink)' : 'var(--w14-ink-faded)',
                }}
              >
                {tn}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="md"
            disabled={aiBusy !== false}
            onClick={() => callAi('improve', bodyRef.current?.innerText ?? '')}
          >
            {aiBusy === 'improve' ? 'Verbessert…' : '✦ Text verbessern'}
          </Button>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            placeholder="Beschreibe kurz, was geschrieben werden soll… z. B. „Mahnung für offene 250 €, höflich aber bestimmt“"
            style={{
              width: '100%',
              marginTop: 10,
              padding: '8px 10px',
              border: '1px solid var(--w14-rule)',
              borderRadius: 8,
              background: 'var(--w14-parchment-1)',
              fontSize: '0.84rem',
              color: 'var(--w14-ink)',
              resize: 'vertical',
            }}
          />
          <Button
            variant="primary"
            size="md"
            disabled={aiBusy !== false}
            onClick={() => callAi('generate', aiPrompt)}
            style={{ marginTop: 8, width: '100%' }}
          >
            {aiBusy === 'generate' ? 'Generiert…' : '✦ Text generieren'}
          </Button>
        </div>

        <div style={{ marginTop: 18 }}>
          <DiamondRule />
          <Button
            variant="primary"
            size="md"
            onClick={() => window.print()}
            style={{ width: '100%', marginTop: 10 }}
          >
            Drucken (A4)
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => applyTemplate(template)}
            style={{ width: '100%', marginTop: 8 }}
          >
            Felder zurücksetzen
          </Button>
        </div>
      </nav>

      {/* ── A4 sheet ───────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'grid',
          placeItems: 'start center',
          padding: 24,
        }}
      >
        <article
          className="w14-a4"
          style={{
            width: '210mm',
            minHeight: '297mm',
            background: '#fff',
            color: '#15181d',
            boxShadow: '0 8px 30px rgba(16,24,40,.14)',
            padding: '20mm 18mm',
            fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif',
            fontSize: '11pt',
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
        >
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
            }}
          >
            <img src="/shop-logo.svg" alt={shop.name} style={{ height: '22mm', width: 'auto' }} />
            <div
              style={{ textAlign: 'right', fontSize: '9.5pt', color: '#3c424b', lineHeight: 1.45 }}
            >
              <div style={{ fontWeight: 700, color: '#15181d' }}>{shop.name || SHOP_INFO.name}</div>
              {shop.tagline && <div style={{ fontStyle: 'italic' }}>{shop.tagline}</div>}
              {shop.address.map((l) => (
                <div key={l}>{l}</div>
              ))}
              {shop.phone && <div>Tel.: {shop.phone}</div>}
              {shop.vatId && <div>USt-IdNr.: {shop.vatId}</div>}
            </div>
          </header>

          <div style={{ borderTop: '1.5px solid #b8902f', margin: '6mm 0 8mm' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <Editable
              refEl={empfaengerRef}
              ph="Empfänger: Name und Anschrift…"
              ariaLabel="Empfänger"
              style={{ minHeight: '24mm', minWidth: '80mm', fontSize: '11pt' }}
            />
            <div
              style={{
                textAlign: 'right',
                fontSize: '10.5pt',
                color: '#3c424b',
                whiteSpace: 'nowrap',
              }}
            >
              {(shop.address[1] ?? 'Schorndorf').replace(/^\d+\s*/, '')}, den {TODAY()}
            </div>
          </div>

          <Editable
            refEl={betreffRef}
            ph="Betreff…"
            ariaLabel="Betreff"
            style={{ fontWeight: 700, fontSize: '12pt', margin: '8mm 0 5mm' }}
          />

          <Editable
            refEl={bodyRef}
            ph="Hier klicken und den Text schreiben — oder den KI-Assistenten links nutzen…"
            ariaLabel="Inhalt"
            style={{ minHeight: '120mm', whiteSpace: 'pre-wrap', fontSize: '11pt' }}
          />

          {currentDef.showSignature && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '18mm',
                fontSize: '10pt',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #15181d', width: '60mm', marginBottom: 4 }} />
                {shop.name || SHOP_INFO.name}
                {actor ? ` · ${actor.role === 'ADMIN' ? 'Inhaber' : 'Mitarbeiter'}` : ''}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #15181d', width: '60mm', marginBottom: 4 }} />
                Kunde / Verkäufer
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function Editable({
  refEl,
  ph,
  ariaLabel,
  style,
}: {
  refEl: React.RefObject<HTMLDivElement>;
  ph: string;
  ariaLabel: string;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div
      ref={refEl}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      tabIndex={0}
      data-ph={ph}
      style={style}
    />
  );
}
