/**
 * useInvoicePdf — compile an invoice to PDF via the native Typst backend
 * (`generate_invoice_pdf` Tauri command). No browser/Puppeteer involved; the
 * Rust binary typesets the PDF in-process and returns the raw bytes.
 *
 * Open/save the result with:
 *   const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { describeError } from '@warehouse14/i18n-de';

import { describeHardwareError, isHardwareError } from '../lib/hardware-client.js';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPriceEur: string;
  /** VAT rate as printed, e.g. "19" / "7" / "" for §25a/§25c margin schemes. */
  vatRate: string;
  totalEur: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  date: string;
  sellerName: string;
  items: InvoiceItem[];
  subtotalEur: string;
  vatTotalEur: string;
  totalEur: string;
  /** Legal tax note (§25a / §25c / §13b), printed on the PDF if present. */
  taxNote?: string;
}

export interface UseInvoicePdf {
  generatePdf: (data: InvoiceData) => Promise<Uint8Array>;
  loading: boolean;
  error: string | null;
}

export function useInvoicePdf(): UseInvoicePdf {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePdf = useCallback(async (data: InvoiceData): Promise<Uint8Array> => {
    setLoading(true);
    setError(null);
    try {
      // Rust returns `Vec<u8>`, which arrives over IPC as a byte-number array.
      const bytes = await invoke<number[]>('generate_invoice_pdf', { data });
      return new Uint8Array(bytes);
    } catch (err) {
      // The command now returns the HardwareError union — prefer its clean
      // German sentence; fall back to describeError for any non-hardware shape.
      setError(isHardwareError(err) ? describeHardwareError(err) : describeError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { generatePdf, loading, error };
}

/** Convenience: wrap the PDF bytes in an object URL for preview/download. */
export function pdfBytesToObjectUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}
