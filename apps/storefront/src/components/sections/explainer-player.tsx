"use client";

// Inner client-only wrapper around the Remotion Player. Loaded exclusively via
// a dynamic ssr:false import, so @remotion/player never touches the server.
import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useInView, useReducedMotion } from "framer-motion";
import { ExplainerVideo, EXPLAINER } from "@/remotion/explainer";

export function ExplainerPlayer() {
  const wrap = useRef<HTMLElement>(null);
  const player = useRef<PlayerRef>(null);
  const inView = useInView(wrap, { amount: 0.45 });
  const reduce = useReducedMotion();

  // Ambient autoplay: runs while on screen, pauses when scrolled away. Honours
  // prefers-reduced-motion by staying paused on the first frame.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    try {
      if (inView && !reduce) p.play();
      else p.pause();
    } catch {
      /* player not ready yet */
    }
  }, [inView, reduce]);

  // Feather every edge so the film bleeds into the dark section instead of
  // sitting in a hard "video box". Vertical fade is strongest (top + bottom).
  const feather =
    "linear-gradient(to bottom, transparent 0%, #000 11%, #000 89%, transparent 100%), linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)";

  return (
    <figure
      ref={wrap}
      aria-label="Erklärungsvideo: Die Geschichte hinter jedem Stück"
      className="relative"
      style={{
        maskImage: feather,
        WebkitMaskImage: feather,
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <Player
        ref={player}
        component={ExplainerVideo}
        durationInFrames={EXPLAINER.durationInFrames}
        fps={EXPLAINER.fps}
        compositionWidth={EXPLAINER.width}
        compositionHeight={EXPLAINER.height}
        style={{ width: "100%", display: "block" }}
        loop
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        renderLoading={() => <div style={{ position: "absolute", inset: 0, background: "#17130c" }} />}
      />
    </figure>
  );
}
