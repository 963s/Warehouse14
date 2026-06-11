/* Payment + shipping acceptance marks — the REAL logos, self-hosted under
 * /public/brands/ and shown in their original brand colours (standard
 * acceptance-mark practice: the mark itself is never recoloured; the calm
 * house treatment lives in the uniform white chip + hairline border around it).
 *
 * Sources (official vector files via Wikimedia Commons, sanitised: editor
 * metadata stripped, no scripts/rasters, colours untouched):
 *   visa.svg        https://commons.wikimedia.org/wiki/File:Visa_Inc._logo_(2021–present).svg
 *   mastercard.svg  https://commons.wikimedia.org/wiki/File:Mastercard_2019_logo.svg
 *   paypal.svg      https://commons.wikimedia.org/wiki/File:PayPal.svg
 *   apple-pay.svg   https://commons.wikimedia.org/wiki/File:Apple_Pay_logo.svg
 *   google-pay.svg  https://commons.wikimedia.org/wiki/File:Google_Pay_Logo.svg
 *   klarna.svg      https://commons.wikimedia.org/wiki/File:Klarna_Logo_black.svg
 *   sepa.svg        https://commons.wikimedia.org/wiki/File:Single_Euro_Payments_Area_logo.svg
 *   dhl.svg         https://commons.wikimedia.org/wiki/File:DHL_Logo.svg
 */

function PayChip({ src, label, className = "h-6", pad = "p-[4px]" }: {
  src: string;
  label: string;
  className?: string;
  pad?: string;
}) {
  return (
    <span className={`inline-flex aspect-[3/2] items-center justify-center overflow-hidden rounded-[4px] border border-rule bg-card ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} loading="lazy" decoding="async" className={`h-full w-full object-contain ${pad}`} />
    </span>
  );
}

export function VisaIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/visa.svg" label="Visa" className={className} pad="px-[6px] py-[4px]" />;
}

export function MastercardIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/mastercard.svg" label="Mastercard" className={className} pad="p-[4px]" />;
}

export function PaypalIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/paypal.svg" label="PayPal" className={className} pad="px-[5px] py-[4px]" />;
}

export function ApplePayIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/apple-pay.svg" label="Apple Pay" className={className} pad="px-[7px] py-[5px]" />;
}

export function GooglePayIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/google-pay.svg" label="Google Pay" className={className} pad="px-[7px] py-[4px]" />;
}

export function KlarnaIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/klarna.svg" label="Klarna" className={className} pad="px-[5px] py-[4px]" />;
}

export function SepaIcon({ className = "h-6" }: { className?: string }) {
  /* The official SEPA lockup carries two subtext lines ("Single Euro Payments
   * Area" / "Einheitlicher Euro-Zahlungsverkehrsraum") that turn into grey
   * noise at chip size. A wrapper svg crops the file to the S€PA wordmark:
   * its bbox in the file's user units is x 0..192.2, y 0..52.7, and the
   * image rect mirrors the file's viewBox (-2.408 -2.408 196.951 85.082) so
   * file coordinates map 1:1 onto ours. The clipPath does the real cropping —
   * a viewBox alone only remaps coordinates, letterbox bands would still
   * expose the subtext. Asset and brand colours stay untouched. */
  return (
    <span className={`inline-flex aspect-[3/2] items-center justify-center overflow-hidden rounded-[4px] border border-rule bg-card ${className}`}>
      <svg viewBox="0 0 192.2 52.7" className="h-full w-full px-[5px] py-[7px]" role="img" aria-label="SEPA Überweisung">
        <clipPath id="sepa-wordmark-clip">
          <rect x="0" y="0" width="192.2" height="52.7" />
        </clipPath>
        <image
          href="/brands/sepa.svg"
          x="-2.408"
          y="-2.408"
          width="196.951"
          height="85.082"
          clipPath="url(#sepa-wordmark-clip)"
        />
      </svg>
    </span>
  );
}

export function DhlIcon({ className }: { className?: string }) {
  return <PayChip src="/brands/dhl.svg" label="DHL" className={className} pad="px-[4px] py-[8px]" />;
}

/* ── Identity marks for social login ─────────────────────────────────── */

/* Monochrome by design (currentColor): the house palette allows no brand
 * yellow/blue at rest. The G silhouette stays recognisable in plain ink. */
export function GoogleG({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" role="img" aria-label="Google" fill="currentColor">
      <path d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17Z" />
      <path d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46Z" />
      <path d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7Z" />
      <path d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07Z" />
    </svg>
  );
}

export function AppleLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Apple" fill="currentColor">
      <path d="M16.36 12.78c.03 3.13 2.75 4.17 2.78 4.18-.02.07-.43 1.49-1.43 2.95-.86 1.27-1.76 2.53-3.17 2.55-1.39.03-1.83-.82-3.42-.82-1.58 0-2.07.8-3.39.85-1.36.05-2.4-1.37-3.27-2.63-1.78-2.58-3.14-7.28-1.31-10.45.91-1.58 2.53-2.57 4.29-2.6 1.34-.02 2.6.9 3.42.9.82 0 2.36-1.11 3.97-.95.68.03 2.57.27 3.79 2.07-.1.06-2.26 1.32-2.24 3.94M13.78 4.5c.73-.88 1.22-2.11 1.08-3.33-1.05.04-2.32.7-3.07 1.58-.67.78-1.26 2.03-1.1 3.22 1.17.09 2.36-.59 3.09-1.47" />
    </svg>
  );
}

export function WhatsAppIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="WhatsApp" fill="currentColor">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.518 5.26l-.999 3.648 3.97-1.027zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.148-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}
