/**
 * useScaleWeight — read a stable weight from a USB serial scale (MT-SICS) via
 * the Rust `read_scale_weight` Tauri command. Exposes loading/error state plus
 * `readWeight(portPath)` for the Ankauf/Bewertung weigh-in flows, and
 * `listPorts()` to populate the Gerätemanager port dropdown.
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';

export interface ScaleWeight {
  /** Weight in grams as the scale reported it (string preserves precision). */
  grams: string;
}

export interface UseScaleWeight {
  /** Read a stable weight from the given serial port (baud defaults to 9600). */
  readWeight: (portPath: string, baudRate?: number) => Promise<ScaleWeight>;
  /** Enumerate available serial ports. */
  listPorts: () => Promise<string[]>;
  weight: ScaleWeight | null;
  loading: boolean;
  error: string | null;
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'details' in err) {
    return String((err as { details?: unknown }).details ?? 'Waage nicht erreichbar');
  }
  return err instanceof Error ? err.message : String(err);
}

export function useScaleWeight(): UseScaleWeight {
  const [weight, setWeight] = useState<ScaleWeight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readWeight = useCallback(
    async (portPath: string, baudRate?: number): Promise<ScaleWeight> => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<ScaleWeight>('read_scale_weight', {
          portPath,
          ...(baudRate !== undefined ? { baudRate } : {}),
        });
        setWeight(result);
        return result;
      } catch (err) {
        setError(describeError(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const listPorts = useCallback(async (): Promise<string[]> => {
    return invoke<string[]>('list_scale_ports');
  }, []);

  return { readWeight, listPorts, weight, loading, error };
}
