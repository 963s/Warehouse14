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

  // Mirror the sale-receipt path (BezahlenDialog): a USB printer is ready once a
  // queue is picked (no IP), a network printer needs an IP. The old check only
  // looked at the IP, so the Belegdesigner "Testdruck" could never reach a USB
  // receipt printer — exactly the "I edit the design but can't print" report.
  const usbMode = cfg.thermal.mode === 'usb';
  const canPrint =
    isRunningInTauri() &&
    (usbMode ? cfg.thermal.printerName.length > 0 : cfg.thermal.ip.length > 0);

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
        // USB mode → raw ESC/POS to the OS queue (no IP); network → ip:port.
        const endpoint = usbMode
          ? { ip: '', port: 9100, printerName: cfg.thermal.printerName }
          : { ip: cfg.thermal.ip, port: cfg.thermal.port };
        await thermalClient.print(endpoint, data);
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
    [canPrint, usbMode, cfg.thermal.ip, cfg.thermal.port, cfg.thermal.printerName, addToast],
  );

  return { canPrint, printing, print };
}
