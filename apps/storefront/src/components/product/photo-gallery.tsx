'use client';

import { ProductImage } from '@/components/product/product-image';
import { cn } from '@/lib/cn';
import type { ProductImage as PImage } from '@/lib/storefront-data';
import {
  AnimatePresence,
  type PanInfo,
  type Variants,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const EASE = [0.16, 1, 0.3, 1] as const;
/** Horizontal drag past this (px) commits a slide change (touch + trackpad). */
const SWIPE_THRESHOLD = 56;
/** Loupe lens radius in px — the glass of the house loupe over the piece. */
const LENS_R = 84;

/**
 * The PDP gallery. A calm, framed switcher that leads with the primary image
 * and supports thumbnails, arrows, keyboard (←/→, Esc), touch/trackpad swipe,
 * and a full-screen lightbox. Lazy-loads non-primary frames. Degrades cleanly
 * to a single framed image (no chrome) and to the neutral cream "Foto folgt"
 * placeholder when a product has no photos at all.
 *
 * THE LOUPE: with a fine pointer (mouse/trackpad), hovering the main image
 * raises a circular magnifier — a hairline-ringed lens showing the photo at
 * 2x, following the pointer like the owner's loupe over a stamp. Pure
 * transform/clip-path updates via refs (no re-render per move, 60fps).
 * Touch devices keep their native gestures (swipe, dots, tap to lightbox);
 * reduced motion skips the lens — the lightbox stays as the static zoom.
 */
export function PhotoGallery({ images }: { images: PImage[] }) {
  // Primary first, then by display order. (The data layer already returns
  // imageUrls primary-first, but we re-assert it so any source order is safe.)
  const sorted = [...images].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return a.order - b.order;
  });

  const reduce = useReducedMotion();
  const [selected, setSelected] = useState(0);
  const [dir, setDir] = useState(1);
  const [zoom, setZoom] = useState(false);
  const count = sorted.length;
  const current = sorted[selected] ?? sorted[0] ?? null;
  const multiple = count > 1;

  // ── the loupe ──────────────────────────────────────────────────────────
  const [finePointer, setFinePointer] = useState(false);
  const [lensActive, setLensActive] = useState(false);
  const [lensMounted, setLensMounted] = useState(false);
  const lensBoxRef = useRef<HTMLDivElement>(null);
  const lensClipRef = useRef<HTMLDivElement>(null);
  const lensZoomRef = useRef<HTMLDivElement>(null);
  const lensRingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Only real photos earn the loupe — never the "Foto folgt" matte.
  const lensEnabled =
    finePointer && !reduce && !!current?.url && !current.url.startsWith('gradient:');

  /** Pure ref writes — clip-path + transforms only, no re-render per move. */
  const moveLens = useCallback((e: React.PointerEvent) => {
    const box = lensBoxRef.current;
    const clip = lensClipRef.current;
    const zoomLayer = lensZoomRef.current;
    const ring = lensRingRef.current;
    if (!box || !clip || !zoomLayer || !ring) return;
    const r = box.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    const y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    clip.style.clipPath = `circle(${LENS_R}px at ${x}px ${y}px)`;
    zoomLayer.style.transformOrigin = `${x}px ${y}px`;
    ring.style.transform = `translate3d(${x - LENS_R}px, ${y - LENS_R}px, 0)`;
  }, []);

  const onLensMove = useCallback(
    (e: React.PointerEvent) => {
      if (!lensEnabled || e.pointerType !== 'mouse') return;
      if (!lensActive && e.buttons === 0) {
        setLensActive(true);
        setLensMounted(true);
      }
      moveLens(e);
    },
    [lensEnabled, lensActive, moveLens],
  );

  const hideLens = useCallback(() => setLensActive(false), []);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setDir(next > selected || (selected === count - 1 && next === 0) ? 1 : -1);
      setSelected((next + count) % count);
    },
    [selected, count],
  );

  // keyboard: arrows navigate, Escape closes the lightbox
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoom(false);
      if (!multiple) return;
      if (e.key === 'ArrowRight') go(selected + 1);
      if (e.key === 'ArrowLeft') go(selected - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, selected, multiple]);

  // lightbox: lock the page scroll behind the overlay, restore on close
  useEffect(() => {
    if (!zoom) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [zoom]);

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      if (!multiple) return;
      if (info.offset.x <= -SWIPE_THRESHOLD) go(selected + 1);
      else if (info.offset.x >= SWIPE_THRESHOLD) go(selected - 1);
    },
    [go, selected, multiple],
  );

  const slide: Variants = {
    initial: (d: number) => ({ opacity: 0, x: reduce ? 0 : d * 28 }),
    animate: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : d * -28 }),
  };

  // No-image state: a single framed neutral cream tile, no chrome.
  if (count === 0) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-card border border-rule bg-raised p-w14-3 shadow-card">
        <ProductImage
          image={null}
          className="h-full w-full"
          emojiClassName="text-8xl"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        <span
          className="pointer-events-none absolute inset-0 rounded-card ring-1 ring-inset ring-black/[0.06]"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-w14-2">
      {/* Framed main image (matches the catalog card frame), click to zoom.
       *  Generous neutral cream matting so coins/objects read whole. */}
      <div
        className="group relative aspect-square w-full overflow-hidden rounded-card border border-rule bg-raised p-w14-3 shadow-card"
        onPointerMove={onLensMove}
        onPointerLeave={hideLens}
        onPointerDown={hideLens}
      >
        <AnimatePresence custom={dir} initial={false} mode="popLayout">
          <motion.button
            key={selected}
            type="button"
            custom={dir}
            variants={slide}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.42, ease: EASE }}
            drag={multiple && !reduce ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={onDragEnd}
            onClick={() => setZoom(true)}
            aria-label="Bild vergrössern"
            className="absolute inset-w14-3 cursor-zoom-in touch-pan-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/40"
          >
            <ProductImage
              image={current}
              className="pointer-events-none h-full w-full"
              emojiClassName="text-8xl"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority={selected === 0}
            />
          </motion.button>
        </AnimatePresence>
        <span
          className="pointer-events-none absolute inset-0 rounded-card ring-1 ring-inset ring-black/[0.06]"
          aria-hidden="true"
        />

        {/* THE LOUPE — a clipped 2x copy registered with the photo below,
         *  plus a hairline ring with the loupe's handle hint. Mouse only. */}
        {lensEnabled && lensMounted && current && (
          <div
            ref={lensBoxRef}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-w14-3 z-10 transition-opacity duration-150',
              lensActive ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div
              ref={lensClipRef}
              className="absolute inset-0"
              style={{ clipPath: 'circle(0px at -200px -200px)' }}
            >
              <div
                ref={lensZoomRef}
                className="absolute inset-0"
                style={{ transform: 'scale(2)', transformOrigin: '50% 50%' }}
              >
                <ProductImage image={current} className="h-full w-full" sizes="100vw" />
              </div>
            </div>
            <div
              ref={lensRingRef}
              className="absolute left-0 top-0 rounded-full border border-ink/35 shadow-[0_2px_14px_rgba(26,23,18,0.18)]"
              style={{
                width: LENS_R * 2,
                height: LENS_R * 2,
                transform: 'translate3d(-9999px, -9999px, 0)',
              }}
            >
              <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/40" />
              <span className="absolute -bottom-[13px] -right-[13px] h-[18px] w-[2px] rotate-[-45deg] rounded-full bg-ink/35" />
            </div>
          </div>
        )}

        <span className="pointer-events-none absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-ink/55 text-white opacity-0 backdrop-blur-sm transition-opacity duration-base ease-hover group-hover:opacity-100">
          <ZoomIn className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </span>

        {multiple && (
          <>
            <button
              type="button"
              onClick={() => go(selected - 1)}
              aria-label="Vorheriges Bild"
              className="absolute left-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-card/85 text-ink shadow-card backdrop-blur-sm transition-colors duration-fast ease-hover hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(selected + 1)}
              aria-label="Nächstes Bild"
              className="absolute right-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-card/85 text-ink shadow-card backdrop-blur-sm transition-colors duration-fast ease-hover hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
            >
              <ChevronRight className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            </button>
            {/* swipe-position dots — current frame reads as a wide ink pill */}
            <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
              {sorted.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-base ease-hover',
                    i === selected ? 'w-5 bg-ink' : 'w-1.5 bg-ink/25',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Calm thumbnail rail */}
      {multiple && (
        <div className="flex gap-w14-2 overflow-x-auto pb-1">
          {sorted.map((img, idx) => (
            <button
              key={img.url ?? img.altDe ?? idx}
              type="button"
              onClick={() => go(idx)}
              aria-label={img.altDe ?? `Bild ${idx + 1}`}
              aria-current={selected === idx}
              className={cn(
                'relative h-16 w-16 flex-none overflow-hidden rounded-card border bg-raised p-1.5 transition-[border-color,opacity] duration-fast ease-hover motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
                selected === idx ? 'border-ink' : 'border-rule opacity-65 hover:opacity-100',
              )}
            >
              <ProductImage
                image={img}
                className="h-full w-full"
                emojiClassName="text-2xl"
                sizes="64px"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {zoom && current && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Bildansicht"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm [overscroll-behavior:contain]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setZoom(false)}
          >
            <button
              type="button"
              onClick={() => setZoom(false)}
              aria-label="Schliessen"
              className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            </button>
            <motion.div
              className="relative aspect-square w-full max-w-3xl overflow-hidden rounded-card"
              initial={reduce ? false : { scale: 0.94 }}
              animate={{ scale: 1 }}
              exit={reduce ? undefined : { scale: 0.94 }}
              transition={{ duration: 0.3, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
            >
              <ProductImage
                image={current}
                className="h-full w-full"
                emojiClassName="text-[10rem]"
                sizes="(max-width: 768px) 100vw, 768px"
                priority
              />
              {multiple && (
                <>
                  <button
                    type="button"
                    onClick={() => go(selected - 1)}
                    aria-label="Vorheriges Bild"
                    className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(selected + 1)}
                    aria-label="Nächstes Bild"
                    className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <ChevronRight className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
