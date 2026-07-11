import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { neighborsOf, portAreas } from "../../engine/world/classic.ts";
import type { AreaId } from "../../engine/types.ts";
import type { AreaState } from "../../engine/state/gameState.ts";
import { perceive } from "../../engine/state/knowledge.ts";
import type { Perception } from "../../engine/state/knowledge.ts";
import type { Point } from "../../engine/world/types.ts";
import { intelAgeLabel, terrainLabel } from "../labels.ts";
import { useGame } from "../store.ts";
import { usePanZoom } from "./usePanZoom.ts";

function troopsK(n: number): string {
  if (n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Deterministic dark color for an un-conquered area, derived from its id so it's
 * stable across renders and independent of continent/region. Kept dark so
 * neutral land reads as clearly distinct from the bright conquered powers.
 */
function neutralFill(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Skip the sea-blue hue band (~200..255) so coastal neutrals never blend into
  // the ocean (which is ~hsl(211, 61%, 13%)).
  let hue = Math.abs(h) % 305;
  if (hue >= 200) hue += 55; // maps into [0,200) ∪ [255,360)
  // Derive independent entropy for saturation and lightness so neutrals vary in
  // tone, while staying dark enough to read as clearly below the bright powers
  // yet lighter than the sea so coastlines stay legible.
  const h2 = Math.abs(Math.imul(h ^ 0x9e3779b9, 16777619));
  const h3 = Math.abs(Math.imul(h2 ^ 0x85ebca6b, 16777619));
  const sat = 35 + (h2 % 28); // 35%..62%
  const light = 22 + (h3 % 15); // 22%..36%
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** Five-pointed star path centered at (cx, cy). */
function starPath(cx: number, cy: number, rOuter: number): string {
  const rInner = rOuter * 0.45;
  let d = "";
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    d += `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Crenellated fortress silhouette centered at (cx, cy); `s` is the half-width. */
function fortPath(cx: number, cy: number, s: number): string {
  const w = s * 2;
  const h = s * 1.7;
  const left = cx - s;
  const top = cy - h / 2;
  const bot = cy + h / 2;
  const m = w / 5;
  const notch = h * 0.32;
  return (
    `M${left.toFixed(2)} ${bot.toFixed(2)}` +
    `L${left.toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + m).toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + m).toFixed(2)} ${(top + notch).toFixed(2)}` +
    `L${(left + 2 * m).toFixed(2)} ${(top + notch).toFixed(2)}` +
    `L${(left + 2 * m).toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + 3 * m).toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + 3 * m).toFixed(2)} ${(top + notch).toFixed(2)}` +
    `L${(left + 4 * m).toFixed(2)} ${(top + notch).toFixed(2)}` +
    `L${(left + 4 * m).toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + w).toFixed(2)} ${top.toFixed(2)}` +
    `L${(left + w).toFixed(2)} ${bot.toFixed(2)}Z`
  );
}

/** Area-weighted centroid of a polygon ring, plus its (absolute) area. */
function ringCentroid(ring: readonly Point[]): { x: number; y: number; area: number } {
  const n = ring.length;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n, area: 0 };
  }
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

/** Visual center of a territory: the centroid of its largest ring (mainland). */
function markerCenter(shape: readonly (readonly Point[])[], fallback: Point): Point {
  let best: { x: number; y: number; area: number } | null = null;
  for (const ring of shape) {
    if (ring.length < 3) continue;
    const c = ringCentroid(ring);
    if (best === null || c.area > best.area) best = c;
  }
  return best === null ? fallback : { x: best.x, y: best.y };
}

/** Build an SVG path spanning every ring of a territory shape. */
function shapePath(shape: readonly (readonly Point[])[]): string {
  return shape
    .map((ring) => {
      if (ring.length === 0) return "";
      const [first, ...rest] = ring;
      const head = `M${first!.x} ${first!.y}`;
      const body = rest.map((p) => `L${p.x} ${p.y}`).join("");
      return `${head}${body}Z`;
    })
    .join(" ");
}

/**
 * Territory markers, clustered tightly on the label anchor so they stay inside
 * even small countries: a gold star for a production hub (supply center), a
 * stone fortress for a fortified area, the troop count, and an anchor + count
 * for fleets.
 */
function AreaMarkers({
  st,
  view,
  cx,
  cy,
  u,
}: {
  st: AreaState;
  view: Perception;
  cx: number;
  cy: number;
  u: number;
}): React.JSX.Element {
  const hasHub = st.supplyCenterOf !== null && st.owner === st.supplyCenterOf;
  const hasFort = st.fortified;
  // Troop/fleet figures reflect what the human knows: exact for own areas, a
  // stale espionage snapshot otherwise. Stale numbers are dimmed to signal that.
  const stale = view.kind === "report";
  const troops = view.kind === "unknown" ? 0 : view.troops;
  const fleets = view.kind === "unknown" ? 0 : view.fleets;
  const showTroops = view.kind !== "unknown" && troops > 0;
  const showFleets = view.kind !== "unknown" && fleets > 0;
  const badgeR = 0.2 * u;
  // Badges flank the troop number horizontally and share its mid-latitude, so a
  // hub star never drifts north into a neighboring (stacked) country. When there
  // is no number to flank they sit compactly beside the center.
  const sideGap = showTroops ? 0.85 * u : 0.25 * u;
  return (
    <>
      {hasHub && (
        <path
          d={starPath(cx - sideGap, cy, badgeR)}
          fill="#ffd23f"
          stroke="#3a2a00"
          strokeWidth={0.025 * u}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}
      {hasFort && (
        <path
          d={fortPath(cx + sideGap, cy, badgeR)}
          fill="#9aa6b8"
          stroke="#0a1a2a"
          strokeWidth={0.025 * u}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}
      {showTroops && (
        <text
          x={cx}
          y={cy + 0.17 * u}
          fontSize={0.48 * u}
          textAnchor="middle"
          fill={stale ? "#c7ced6" : "#ffffff"}
          fillOpacity={stale ? 0.85 : 1}
          stroke="#000"
          strokeWidth={0.03 * u}
          paintOrder="stroke"
          style={{ pointerEvents: "none", fontWeight: 700, fontStyle: stale ? "italic" : "normal" }}
        >
          {stale ? `~${troopsK(troops)}` : troopsK(troops)}
        </text>
      )}
      {showFleets && (
        <text
          x={cx}
          y={cy + 0.62 * u}
          fontSize={0.36 * u}
          textAnchor="middle"
          fill="#bfe9ff"
          fillOpacity={stale ? 0.8 : 1}
          stroke="#000"
          strokeWidth={0.025 * u}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {`\u2693 ${fleets}`}
        </text>
      )}
    </>
  );
}

export function MapView(): React.JSX.Element {
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const gameState = useGame((s) => s.gameState);
  const humanPower = useGame((s) => s.humanPower);
  const selectedArea = useGame((s) => s.selectedArea);
  const moveMode = useGame((s) => s.moveMode);
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);
  const handleMapClick = useGame((s) => s.handleMapClick);
  const dismiss = useGame((s) => s.dismiss);

  const [hovered, setHovered] = useState<AreaId | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Flash an area whenever its controller changes (subversion, conquest, revolt).
  // `nonce` bumps on each change so re-capturing the same area replays the effect.
  const prevOwners = useRef<Record<string, string | null> | null>(null);
  const [flashes, setFlashes] = useState<Map<AreaId, number>>(new Map());

  useEffect(() => {
    if (gameState === null) return;
    const prev = prevOwners.current;
    const nextOwners: Record<string, string | null> = {};
    const changed: AreaId[] = [];
    for (const st of Object.values(gameState.areas)) {
      const owner = st.owner === null ? null : String(st.owner);
      nextOwners[String(st.id)] = owner;
      if (prev !== null && prev[String(st.id)] !== undefined && prev[String(st.id)] !== owner) {
        changed.push(st.id);
      }
    }
    if (changed.length > 0) {
      setFlashes((m) => {
        const next = new Map(m);
        for (const id of changed) next.set(id, (next.get(id) ?? 0) + 1);
        return next;
      });
    }
    prevOwners.current = nextOwners;
  }, [gameState]);

  const clearFlash = (id: AreaId): void =>
    setFlashes((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });

  const bounds = world.bounds;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  // Globe-like east-west wrap: render the world at these x offsets so panning
  // across the seam is seamless. Flat maps (no wrapX) render a single copy.
  const offsets = useMemo(
    () => (world.wrapX !== undefined ? [-world.wrapX, 0, world.wrapX] : [0]),
    [world.wrapX],
  );
  const wrapConfig = useMemo(
    () => (world.wrapX !== undefined ? { period: world.wrapX, center: centerX } : undefined),
    [world.wrapX, centerX],
  );
  /** Marker base unit, so glyphs stay proportional across differently scaled worlds. */
  const u = width / 150;

  /**
   * What the human perceives per area: exact for its own, a stale snapshot for
   * spied areas, unknown otherwise. Never reads foreign live troop counts.
   */
  const perceptions = useMemo(() => {
    const m = new Map<string, Perception>();
    if (gameState === null || humanPower === null) return m;
    for (const st of Object.values(gameState.areas)) {
      m.set(String(st.id), perceive(gameState, humanPower, st.id));
    }
    return m;
  }, [gameState, humanPower]);
  const unknownView: Perception = { kind: "unknown" };
  const pan = usePanZoom(
    {
      x: bounds.minX,
      y: bounds.minY,
      w: width,
      h: height,
    },
    wrapConfig,
  );

  const powerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ruleSet.powers) m.set(String(p.id), p.color);
    return m;
  }, [ruleSet]);

  const neutralColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of world.areas) m.set(String(a.id), neutralFill(String(a.id)));
    return m;
  }, [world]);

  // Visual center of each territory (largest-ring centroid), so markers sit in
  // the middle of the country rather than on its off-center seed point.
  const markerCenters = useMemo(() => {
    const m = new Map<string, Point>();
    for (const a of world.areas) m.set(String(a.id), markerCenter(a.shape, a.labelAnchor));
    return m;
  }, [world]);

  const highlights = useMemo(() => {
    const set = new Set<AreaId>();
    if (moveFrom === null) return set;
    if (moveMode === "army") {
      for (const n of neighborsOf(world, moveFrom)) set.add(n);
    } else if (moveMode === "fleet") {
      for (const p of portAreas(world)) if (p.id !== moveFrom) set.add(p.id);
    }
    return set;
  }, [moveMode, moveFrom, world]);

  if (gameState === null) return <div />;

  const areaById = new Map<string, AreaState>(Object.entries(gameState.areas));
  const hoveredArea = hovered !== null ? areaById.get(String(hovered)) : undefined;
  const hoveredDef = hovered !== null ? world.areas.find((a) => a.id === hovered) : undefined;

  return (
    <div
      className="map-container"
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        className="map-svg"
        viewBox={pan.viewBox}
        onWheel={pan.onWheel}
        onPointerDown={pan.onPointerDown}
        onPointerMove={pan.onPointerMove}
        onPointerUp={pan.onPointerUp}
        onPointerLeave={pan.onPointerUp}
        style={{ cursor: pan.isPanning ? "grabbing" : "grab" }}
      >
        <defs>
          {/* Crosshatch marking un-conquered (neutral) territory, echoing the
              original game's textured fills. Rendered in map units so it scales
              naturally with pan/zoom. */}
          <pattern
            id="neutral-hatch"
            width={u * 0.2}
            height={u * 0.2}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={u * 0.2}
              stroke="#0a1a2a"
              strokeWidth={u * 0.06}
              strokeOpacity={0.5}
            />
            <line
              x1={0}
              y1={0}
              x2={u * 0.2}
              y2={0}
              stroke="#0a1a2a"
              strokeWidth={u * 0.06}
              strokeOpacity={0.5}
            />
          </pattern>
        </defs>
        <rect
          x={centerX - (world.wrapX ?? width) * 3}
          y={bounds.minY - height}
          width={(world.wrapX ?? width) * 6}
          height={height * 3}
          fill="#0d2136"
          onPointerEnter={() => setHovered(null)}
          onClick={() => {
            if (!pan.isPanning) dismiss();
          }}
        />
        {offsets.map((off) => (
        <g key={`copy-${off}`} transform={off !== 0 ? `translate(${off} 0)` : undefined}>
        {world.areas.map((area) => {
          const st = areaById.get(String(area.id));
          if (st === undefined) return null;
          const owned = st.owner !== null;
          const fill = owned
            ? powerColor.get(String(st.owner)) ?? "#888"
            : neutralColor.get(String(area.id)) ?? "#2a3444";
          const isSel = selectedArea === area.id;
          const isFrom = moveFrom === area.id;
          const isTo = moveTo === area.id;
          const isHi = highlights.has(area.id);
          const d = shapePath(area.shape);
          return (
            <g
              key={`${off}-${String(area.id)}`}
              onClick={(e) => {
                if (!pan.isPanning) handleMapClick(area.id, e.clientX, e.clientY);
              }}
              onPointerEnter={() => setHovered(area.id)}
              style={{ cursor: "pointer" }}
            >
              <path
                d={d}
                fill={fill}
                fillOpacity={owned ? 0.92 : 0.95}
                stroke={isFrom || isTo ? "#ffdd55" : isSel ? "#ffffff" : "#0a1a2a"}
                strokeWidth={isFrom || isTo || isSel ? 2 : 0.6}
                strokeLinejoin="round"
                style={{ vectorEffect: "non-scaling-stroke" }}
              />
              {!owned && (
                <path d={d} fill="url(#neutral-hatch)" style={{ pointerEvents: "none" }} />
              )}
              {isHi && (
                <path
                  d={d}
                  fill="#ffdd55"
                  fillOpacity={0.28}
                  stroke="#ffdd55"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  style={{ pointerEvents: "none", vectorEffect: "non-scaling-stroke" }}
                />
              )}
              {flashes.has(area.id) && (
                <path
                  key={`flash-${String(area.id)}-${flashes.get(area.id)!}`}
                  className="area-flash"
                  d={d}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  style={{ pointerEvents: "none", vectorEffect: "non-scaling-stroke" }}
                  onAnimationEnd={() => clearFlash(area.id)}
                />
              )}
            </g>
          );
        })}
        {/* Markers on a separate top layer so a neighbor's (semi-transparent)
            fill can never paint over another country's stars or numbers. */}
        {world.areas.map((area) => {
          const st = areaById.get(String(area.id));
          if (st === undefined) return null;
          const c = markerCenters.get(String(area.id)) ?? area.labelAnchor;
          return (
            <AreaMarkers
              key={`m-${off}-${String(area.id)}`}
              st={st}
              view={perceptions.get(String(area.id)) ?? unknownView}
              cx={c.x}
              cy={c.y}
              u={u}
            />
          );
        })}
        </g>
        ))}
      </svg>

      {hoveredArea !== undefined && hoveredDef !== undefined && (
        <div className="map-tooltip" style={{ left: mouse.x + 14, top: mouse.y + 14 }}>
          <div className="tt-name">
            {hoveredDef.name}
            <span className="tt-id"> #{String(hoveredDef.id)}</span>
          </div>
          <div className="tt-row">
            Owner:{" "}
            <strong style={{ color: hoveredArea.owner ? powerColor.get(String(hoveredArea.owner)) : "#9fb3c8" }}>
              {hoveredArea.owner
                ? ruleSet.powers.find((p) => p.id === hoveredArea.owner)?.name
                : "Neutral"}
            </strong>
          </div>
          {(() => {
            const view = hovered !== null ? perceptions.get(String(hovered)) ?? unknownView : unknownView;
            if (view.kind === "own") {
              return (
                <>
                  <div className="tt-row">Troops: {hoveredArea.troops.toLocaleString()}</div>
                  {hoveredArea.fleets > 0 && <div className="tt-row">Fleets: {hoveredArea.fleets}</div>}
                  <div className="tt-row">Income: ${(hoveredArea.income / 1_000_000).toFixed(1)}M</div>
                </>
              );
            }
            if (view.kind === "report") {
              return (
                <>
                  <div className="tt-row">
                    Troops: ~{view.troops.toLocaleString()}{" "}
                    <span className="tt-stale">(spied {intelAgeLabel(view.ageSeasons)})</span>
                  </div>
                  {view.fleets > 0 && (
                    <div className="tt-row">
                      Fleets: ~{view.fleets} <span className="tt-stale">(stale)</span>
                    </div>
                  )}
                  <div className="tt-row">Income: ${(hoveredArea.income / 1_000_000).toFixed(1)}M</div>
                </>
              );
            }
            return <div className="tt-row tt-unknown">Troops: unknown — spy to reveal</div>;
          })()}
          <div className="tt-row">VP value: {hoveredArea.victoryValue}</div>
          <div className="tt-row">Terrain: {terrainLabel(ruleSet, hoveredDef.terrain)}</div>
          {hoveredDef.isPort && <div className="tt-row">Port</div>}
          {hoveredArea.fortified && <div className="tt-row">Fortified</div>}
        </div>
      )}
    </div>
  );
}
