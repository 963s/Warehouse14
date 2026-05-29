/**
 * ShippingLabelButton (Epic D) — generate + download a DHL label for a WEB
 * order. Calls `POST /api/shipping/dhl-label`, receives the Base64 PDF, and
 * triggers a browser download so the operator can print it.
 *
 * Rendered on a task whose related entity is a `transactions` row.
 */

import { useMutation } from '@tanstack/react-query';

import { ApiError, shippingApi } from '@warehouse14/api-client';
import { Button } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

/** Decode a Base64 PDF and trigger a download. */
function downloadPdf(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ShippingLabelButton({ transactionId }: { transactionId: string }): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const mutation = useMutation({
    mutationFn: () => shippingApi.dhlLabel(api, { transactionId }),
    onSuccess: (res) => {
      downloadPdf(res.labelBase64, `versandetikett-${res.trackingNumber}.pdf`);
      addToast({
        tone: 'success',
        title: 'Versandetikett erstellt',
        body: `Sendungsnummer ${res.trackingNumber}${res.mock ? ' (Mock)' : ''}`,
      });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Etikett fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  return (
    <Button
      variant="ghost"
      size="md"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? 'Erstellt…' : 'Versandetikett drucken'}
    </Button>
  );
}
