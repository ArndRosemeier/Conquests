import { useCallback, useRef, useState } from "react";
import type React from "react";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoom {
  viewBox: string;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  reset: () => void;
  isPanning: boolean;
}

/**
 * Minimal SVG pan/zoom via the viewBox. No dependency needed - a turn-based
 * vector map does not require a game-engine camera.
 */
/** Deepest zoom-in relative to the full map (max magnification). */
const MAX_ZOOM = 40;

export function usePanZoom(initial: ViewBox): PanZoom {
  const [vb, setVb] = useState<ViewBox>(initial);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  // Capture the full-extent view once so zoom limits scale with the world.
  const extent = useRef<ViewBox>(initial);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setVb((cur) => {
      const full = extent.current;
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const w = Math.min(Math.max(cur.w * factor, full.w / MAX_ZOOM), full.w);
      const h = Math.min(Math.max(cur.h * factor, full.h / MAX_ZOOM), full.h);
      const x = cur.x + (cur.w - w) * px;
      const y = cur.y + (cur.h - h) * py;
      return { x, y, w, h };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY, vb };
  }, [vb]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const start = dragStart.current;
    if (start === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - start.x) / rect.width) * start.vb.w;
    const dy = ((e.clientY - start.y) / rect.height) * start.vb.h;
    if (!isPanning && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
      setIsPanning(true);
    }
    setVb({ x: start.vb.x - dx, y: start.vb.y - dy, w: start.vb.w, h: start.vb.h });
  }, [isPanning]);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    // Defer clearing so a click handler can detect that a pan just happened.
    setTimeout(() => setIsPanning(false), 0);
  }, []);

  const reset = useCallback(() => setVb(initial), [initial]);

  return {
    viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    isPanning,
  };
}
