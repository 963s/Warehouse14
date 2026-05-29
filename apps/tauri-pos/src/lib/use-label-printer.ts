/**
 * useLabelPrinter — one place that turns label payloads into a print call.
 *
 * Reads the configured label printer from the hardware store, dispatches via
 * the Rust bridge (`labelClient.print`), and surfaces a success/error toast.
 * Both the Ankauf receipt and the Bewertung outcome use this.
 */

import { useCallback } from 'react';

import { useHardwareStore } from '../state/hardware-store.js';
import { useToastStore } from '../state/toast-store.js';
import {
  type LabelConfig,
  type LabelData,
  describeHardwareError,
  isHardwareError,
  labelClient,
} from './hardware-client.js';

export interface LabelPrinter {
  /** Print the given labels; resolves true on success, false on failure. */
  print: (labels: LabelData[]) => Promise<boolean>;
  /** True when a label printer has been configured (printer name or IP set). */
  configured: boolean;
}

export function useLabelPrinter(): LabelPrinter {
  const cfg = useHardwareStore((s) => s.config.label);
  const addToast = useToastStore((s) => s.addToast);

  const configured = cfg.mode === 'system' ? cfg.printerName.length > 0 : cfg.ip.length > 0;

  const print = useCallback(
    async (labels: LabelData[]): Promise<boolean> => {
      if (labels.length === 0) return false;
      if (!configured) {
        addToast({
          tone: 'alert',
          title: 'Kein Etikettendrucker konfiguriert',
          body: 'Bitte im Gerätemanager einrichten.',
        });
        return false;
      }
      const config: LabelConfig = {
        mode: cfg.mode,
        ip: cfg.ip || undefined,
        port: cfg.port,
        printerName: cfg.printerName || undefined,
        printerType: cfg.printerType,
      };
      try {
        const n = await labelClient.print(config, labels);
        addToast({
          tone: 'success',
          title: 'Etiketten gedruckt',
          body: `${n} Etikett${n === 1 ? '' : 'en'} gesendet.`,
        });
        return true;
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Etikettendruck fehlgeschlagen',
          body: isHardwareError(err) ? describeHardwareError(err) : String(err),
        });
        return false;
      }
    },
    [addToast, configured, cfg.mode, cfg.ip, cfg.port, cfg.printerName, cfg.printerType],
  );

  return { print, configured };
}
