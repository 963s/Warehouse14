/**
 * useReceiptPrinter — a small reusable thermal-print helper. Reads the hardware
 * config, reports whether printing is possible, and prints a ThermalReceiptData
 * with toast feedback. Used by the reprint action (and shareable elsewhere).
 */

import { useCallback, useState } from 'react';

import {
  type ThermalReceiptData,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  thermalClient,
} from '../lib/hardware-client.js';
import { useHardwareStore } from '../state/hardware-store.js';
import { useToastStore } from '../state/toast-store.js';

export interface ReceiptPrinter {
  canPrint: boolean;
  printing: boolean;
  /** Returns true on a successful print, false on failure / no printer. */
  print: (data: ThermalReceiptData) => Promise<boolean>;
}

export function useReceiptPrinter(): ReceiptPrinter {
  const cfg = useHardwareStore((s) => s.config);
  const addToast = useToastStore((s) => s.addToast);
  const [printing, setPrinting] = useState(false);

  const canPrint = isRunningInTauri() && cfg.thermal.ip.length > 0;

  const print = useCallback(
    async (data: ThermalReceiptData): Promise<boolean> => {
      if (!canPrint) {
        addToast({
          tone: 'info',
          title: 'Kein Drucker',
          body: 'Drucker unter „Geräte" einrichten.',
        });
        return false;
      }
      setPrinting(true);
      try {
        await thermalClient.print({ ip: cfg.thermal.ip, port: cfg.thermal.port }, data);
        return true;
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Druck fehlgeschlagen',
          body: isHardwareError(err) ? describeHardwareError(err) : 'Drucker prüfen.',
        });
        return false;
      } finally {
        setPrinting(false);
      }
    },
    [canPrint, cfg.thermal.ip, cfg.thermal.port, addToast],
  );

  return { canPrint, printing, print };
}
