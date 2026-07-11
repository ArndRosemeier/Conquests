import { useMemo, useState } from "react";
import type React from "react";
import { neighborsOf, portAreas } from "../../engine/world/classic.ts";
import type { AreaId } from "../../engine/types.ts";
import type { AreaState } from "../../engine/state/gameState.ts";
import type { Point } from "../../engine/world/types.ts";
import { useGame } from "../store.ts";
import { usePanZoom } from "./usePanZoom.ts";

function troopsK(n: number): string {
  if (n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
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

export function MapView(): React.JSX.Element {
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const gameState = useGame((s) => s.gameState);
  const selectedArea = useGame((s) => s.selectedArea);
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);
  const handleMapClick = useGame((s) => s.handleMapClick);

  const [hovered, setHovered] = useState<AreaId | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const bounds = world.bounds;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  /** Marker base unit, so glyphs stay proportional across differently scaled worlds. */
  const u = width / 110;
  const pan = usePanZoom({
    x: bounds.minX,
    y: bounds.minY,
    w: width,
    h: height,
  });

  const powerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ruleSet.powers) m.set(String(p.id), p.color);
    return m;
  }, [ruleSet]);

  const regionColor = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of world.regions) m.set(r.id, r.color);
    return m;
  }, [world]);

  const highlights = useMemo(() => {
    const set = new Set<AreaId>();
    if (gameState === null) return set;
    if (gameState.phase === "ARMY_MOVE" && moveFrom !== null) {
      for (const n of neighborsOf(world, moveFrom)) set.add(n);
    } else if (gameState.phase === "FLEET_MOVE" && moveFrom !== null) {
      for (const p of portAreas(world)) if (p.id !== moveFrom) set.add(p.id);
    }
    return set;
  }, [gameState, moveFrom, world]);

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
        <rect
          x={bounds.minX - width}
          y={bounds.minY - height}
          width={width * 3}
          height={height * 3}
          fill="#0d2136"
        />
        {world.areas.map((area) => {
          const st = areaById.get(String(area.id));
          if (st === undefined) return null;
          const owned = st.owner !== null;
          const fill = owned
            ? powerColor.get(String(st.owner)) ?? "#888"
            : regionColor.get(area.region) ?? "#556";
          const isSel = selectedArea === area.id;
          const isFrom = moveFrom === area.id;
          const isTo = moveTo === area.id;
          const isHi = highlights.has(area.id);
          const d = shapePath(area.shape);
          const cx = area.labelAnchor.x;
          const cy = area.labelAnchor.y;
          return (
            <g
              key={String(area.id)}
              onClick={() => {
                if (!pan.isPanning) handleMapClick(area.id);
              }}
              onPointerEnter={() => setHovered(area.id)}
              style={{ cursor: "pointer" }}
            >
              <path
                d={d}
                fill={fill}
                fillOpacity={owned ? 0.92 : 0.55}
                stroke={isFrom || isTo ? "#ffdd55" : isSel ? "#ffffff" : "#0a1a2a"}
                strokeWidth={isFrom || isTo || isSel ? 2 : 0.6}
                strokeLinejoin="round"
                style={{ vectorEffect: "non-scaling-stroke" }}
              />
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
              {st.troops > 0 && (
                <text
                  x={cx}
                  y={cy + 0.2 * u}
                  fontSize={u}
                  textAnchor="middle"
                  fill="#ffffff"
                  stroke="#000"
                  strokeWidth={0.06 * u}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none", fontWeight: 700 }}
                >
                  {troopsK(st.troops)}
                </text>
              )}
              {st.supplyCenterOf !== null && st.owner === st.supplyCenterOf && (
                <text
                  x={cx - 1.3 * u}
                  y={cy - 0.7 * u}
                  fontSize={0.85 * u}
                  fill="#ffe37a"
                  style={{ pointerEvents: "none" }}
                >
                  {"\u2605"}
                </text>
              )}
              {st.fortified && (
                <rect
                  x={cx + 0.75 * u}
                  y={cy + 0.4 * u}
                  width={0.55 * u}
                  height={0.55 * u}
                  fill="#111"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {st.fleets > 0 && (
                <text
                  x={cx + 0.2 * u}
                  y={cy - 0.7 * u}
                  fontSize={0.8 * u}
                  fill="#bfe9ff"
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {`~${st.fleets}`}
                </text>
              )}
            </g>
          );
        })}
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
          <div className="tt-row">Troops: {hoveredArea.troops.toLocaleString()}</div>
          {hoveredArea.fleets > 0 && <div className="tt-row">Fleets: {hoveredArea.fleets}</div>}
          <div className="tt-row">Income: ${(hoveredArea.income / 1_000_000).toFixed(1)}M</div>
          <div className="tt-row">VP value: {hoveredArea.victoryValue}</div>
          {hoveredDef.terrain > 0 && <div className="tt-row">Terrain: {hoveredDef.terrain}</div>}
          {hoveredDef.isPort && <div className="tt-row">Port</div>}
          {hoveredArea.fortified && <div className="tt-row">Fortified</div>}
        </div>
      )}
    </div>
  );
}
