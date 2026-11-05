import { canAttackOwner } from "../../engine/state/diplomacy.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { perceive } from "../../engine/state/knowledge.ts";
import type { AreaId } from "../../engine/types.ts";
import { getArea, neighborsOf, portAreas } from "../../engine/world/classic.ts";
import { intelAgeLabel, terrainLabel } from "../labels.ts";
import { money, powerColor, powerName, troops } from "../content/powers.ts";
import { useGame } from "../store.ts";
import { GlobeView } from "./globeView.ts";
import { MapRenderer } from "./renderer.ts";

/** The interactive world map: pan, zoom, pinch, click to select, hover for details. */
export function MapCanvas(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | GlobeView | null>(null);
  const view = useGame((s) => s.mapView);
  const setMapView = useGame((s) => s.setMapView);
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const gameState = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const selected = useGame((s) => s.selected);
  const move = useGame((s) => s.move);
  const fx = useGame((s) => s.fx);
  const focus = useGame((s) => s.focus);
  const clickArea = useGame((s) => s.clickArea);
  const select = useGame((s) => s.select);
  const consumeFx = useGame((s) => s.consumeFx);
  const [hover, setHover] = useState<{ id: AreaId; x: number; y: number } | null>(null);

  useEffect(() => {
    const r = view === "globe" ? new GlobeView(glRef.current!, world) : new MapRenderer(baseRef.current!, fxRef.current!, world);
    rendererRef.current = r;
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      r.resize(box.width, box.height, Math.min(2, window.devicePixelRatio || 1));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      r.destroy();
      rendererRef.current = null;
    };
  }, [world, view]);

  const colors = useMemo(() => new Map(ruleSet.powers.map((p) => [String(p.id), p.color])), [ruleSet]);
  const names = useMemo(() => new Map(world.areas.map((a) => [a.id, a.name])), [world]);
  const ports = useMemo(() => new Set(portAreas(world).map((a) => a.id)), [world]);

  const targets = useMemo(() => {
    const out = new Set<AreaId>();
    if (move === null || move.to !== null) return out;
    if (move.mode === "army") for (const n of neighborsOf(world, move.from)) out.add(n);
    else for (const p of ports) if (p !== move.from) out.add(p);
    // Land of powers you are at peace with is off limits until you declare war.
    if (gameState !== null && me !== null) {
      for (const id of out) {
        const owner = gameState.areas[String(id)]?.owner ?? null;
        if (!canAttackOwner(gameState, me, owner)) out.delete(id);
      }
    }
    return out;
  }, [move, world, ports, gameState, me]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || gameState === null) return;
    r.setModel({
      areas: gameState.areas,
      perceive: (id) => (me === null ? { kind: "unknown" } : perceive(gameState, me, id)),
      colors,
      me: me === null ? null : String(me),
      pending: gameState.pending,
      selected,
      moveFrom: move?.from ?? null,
      moveTo: move?.to ?? null,
      moveMode: move?.mode ?? null,
      targets,
      names,
      ports,
    });
  }, [gameState, me, selected, move, targets, colors, names, ports, view]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || fx.length === 0) return;
    for (const f of fx) {
      const { id: _id, delay, ...rest } = f;
      void _id;
      r.addEffect(
        {
          from: [],
          bySea: false,
          won: true,
          color: "#ffffff",
          ...rest,
        },
        delay,
      );
    }
    consumeFx(fx.map((f) => f.id));
  }, [fx, consumeFx]);

  useEffect(() => {
    if (focus) rendererRef.current?.flyTo(focus.area);
  }, [focus]);

  // A fresh view starts where the player is looking: the selected area, else the last focus.
  useEffect(() => {
    const at = useGame.getState().selected ?? useGame.getState().focus?.area ?? null;
    if (at !== null) rendererRef.current?.flyTo(at);
  }, [view]);

  // Pointer handling: drag to pan (with a little glide), click to select, two fingers to zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number; pinch: number | null }>({
    moved: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0, pinch: null,
  });

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    rendererRef.current?.stopFling();
    const d = drag.current;
    d.moved = 0;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = performance.now();
    d.vx = 0;
    d.vy = 0;
    d.pinch = null;
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const r = rendererRef.current;
    if (!r) return;
    const p = local(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") {
        const id = r.hitTest(p.x, p.y);
        r.setHover(id);
        setHover(id === null ? null : { id, x: p.x, y: p.y });
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    const d = drag.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d.pinch !== null) r.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, dist / d.pinch);
      d.pinch = dist;
      d.moved += 10;
      return;
    }
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.vx = (dx / dt) * 16;
    d.vy = (dy / dt) * 16;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
    if (d.moved > 4) {
      r.panBy(dx, dy);
      setHover(null);
    }
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    const r = rendererRef.current;
    pointers.current.delete(e.pointerId);
    if (!r) return;
    const d = drag.current;
    if (pointers.current.size > 0) return;
    if (d.moved <= 4) {
      const p = local(e);
      const id = r.hitTest(p.x, p.y);
      if (id !== null) clickArea(id);
      else select(null);
    } else if (performance.now() - d.lastT < 80) {
      r.fling(d.vx, d.vy);
    }
  };

  const onWheel = (e: React.WheelEvent): void => {
    const p = local(e);
    rendererRef.current?.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  const hoverInfo = hover !== null && gameState !== null ? (() => {
    const st = gameState.areas[String(hover.id)];
    const def = getArea(world, hover.id);
    if (!st) return null;
    const view = me === null ? { kind: "unknown" as const } : perceive(gameState, me, hover.id);
    return (
      <div className="map-tip" style={{ left: hover.x + 16, top: hover.y + 16 }}>
        <div className="map-tip-name">{def.name}</div>
        <div className="map-tip-owner" style={{ color: powerColor(ruleSet.powers, st.owner) }}>
          {st.owner === null ? "Independent" : powerName(ruleSet.powers, st.owner)}
          {st.owner === me && me !== null ? " (yours)" : ""}
        </div>
        <div className="map-tip-grid">
          <span>Troops</span>
          <b>
            {view.kind === "unknown" ? "unknown" : view.kind === "report" ? `~${troops(view.troops)}` : troops(view.troops)}
          </b>
          {view.kind === "report" && (
            <>
              <span>Report</span>
              <b className="muted">{intelAgeLabel(view.ageSeasons)}</b>
            </>
          )}
          <span>Worth</span>
          <b>{st.victoryValue} pts · {money(st.income)}/yr</b>
          <span>Terrain</span>
          <b>{terrainLabel(ruleSet, def.terrain)}</b>
        </div>
        <div className="map-tip-tags">
          {def.isPort && <i>Port</i>}
          {st.fortified && <i>Fortified</i>}
          {st.supplyCenterOf !== null && <i>Supply centre</i>}
        </div>
      </div>
    );
  })() : null;

  return (
    <div
      className={`map${view === "globe" ? " globe-view" : ""}`}
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        rendererRef.current?.setHover(null);
      }}
      onWheel={onWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        select(null);
      }}
    >
      {view === "globe" ? (
        <>
          <div className="globe-space" />
          <canvas key="gl" ref={glRef} className="map-layer" />
        </>
      ) : (
        <>
          <div className="map-ocean" />
          <canvas key="base" ref={baseRef} className="map-layer" />
          <canvas key="fx" ref={fxRef} className="map-layer" />
        </>
      )}
      <div className="map-vignette" />
      {hoverInfo}
      <div className="map-zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button aria-label="Zoom in" onClick={() => { const r = rendererRef.current; const b = wrapRef.current?.getBoundingClientRect(); if (r && b) r.zoomAt(b.width / 2, b.height / 2, 1.4); }}>+</button>
        <button aria-label="Zoom out" onClick={() => { const r = rendererRef.current; const b = wrapRef.current?.getBoundingClientRect(); if (r && b) r.zoomAt(b.width / 2, b.height / 2, 1 / 1.4); }}>−</button>
        <button aria-label="Whole world" title="Whole world" onClick={() => rendererRef.current?.fitWorld()}>◎</button>
        <button
          aria-label={view === "globe" ? "Show the flat map" : "Show the globe"}
          title={view === "globe" ? "Flat map" : "Globe"}
          onClick={() => setMapView(view === "globe" ? "flat" : "globe")}
        >
          {view === "globe" ? "🗺" : "🌐"}
        </button>
      </div>
    </div>
  );
}
