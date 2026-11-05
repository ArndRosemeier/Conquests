import type { AreaState, PendingMove } from "../../engine/state/gameState.ts";
import type { Perception } from "../../engine/state/knowledge.ts";
import type { AreaId } from "../../engine/types.ts";
import type { Point, WorldDefinition } from "../../engine/world/types.ts";
import { troops as troopsLabel } from "../content/powers.ts";
import type { AreaGeometry } from "./geometry.ts";
import { arcControl, nearestCopy, quadPoint, worldGeometry } from "./geometry.ts";

/**
 * The game map, drawn on two canvases: a "base" layer with land, borders and
 * markers that is redrawn only when the view or the game changes, and an
 * "fx" layer redrawn every frame for selection glows, marching arrows,
 * battles, captures and other animation. The ocean is CSS behind both.
 */

export interface MapModel {
  readonly areas: Readonly<Record<string, AreaState>>;
  readonly perceive: (id: AreaId) => Perception;
  readonly colors: ReadonlyMap<string, string>;
  readonly me: string | null;
  readonly pending: readonly PendingMove[];
  readonly selected: AreaId | null;
  readonly moveFrom: AreaId | null;
  readonly moveTo: AreaId | null;
  readonly moveMode: "army" | "fleet" | null;
  readonly targets: ReadonlySet<AreaId>;
  readonly names: ReadonlyMap<AreaId, string>;
  readonly ports: ReadonlySet<AreaId>;
}

interface Effect {
  readonly kind: "battle" | "capture" | "coins" | "spy" | "build";
  readonly area: AreaId;
  readonly from: readonly AreaId[];
  readonly bySea: boolean;
  readonly won: boolean;
  readonly color: string;
  readonly start: number;
  readonly duration: number;
  readonly seed: number;
}

export type EffectInput = Omit<Effect, "start" | "duration" | "seed">;

interface Camera {
  x: number; // world x at screen centre
  y: number;
  scale: number; // CSS px per world unit
}

const PARCHMENT = "#d7c49b";
const INK = "rgba(52, 36, 18, 0.55)";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function makePattern(draw: (c: CanvasRenderingContext2D, s: number) => void, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  return c;
}

export class MapRenderer {
  private readonly geo: Map<AreaId, AreaGeometry>;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly fxCtx: CanvasRenderingContext2D;
  private readonly hitCtx: CanvasRenderingContext2D;
  private model: MapModel | null = null;
  private dirty = true;
  private width = 1;
  private sized = false;
  private height = 1;
  private dpr = 1;
  /** Pixel ratio of the animation layer: half the base's in texture mode, where it is redrawn every frame. */
  private fxDpr = 1;
  private cam: Camera;
  private target: Camera | null = null;
  private velocity = { x: 0, y: 0 };
  private effects: Effect[] = [];
  private hover: AreaId | null = null;
  private raf = 0;
  private readonly hatch: HTMLCanvasElement;
  private readonly grain: HTMLCanvasElement;
  private readonly wrap: number | undefined;
  private readonly bounds: WorldDefinition["bounds"];
  private seed = 1;

  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly fx: HTMLCanvasElement,
    world: WorldDefinition,
    /**
     * Texture mode: draw the whole world once, longitude -180..180 across the canvas and
     * latitude 90..-90 down it, for the globe to wrap around a sphere. The globe drives
     * frames itself through `renderFrame`.
     */
    private readonly texture = false,
  ) {
    this.geo = worldGeometry(world);
    this.baseCtx = base.getContext("2d")!;
    this.fxCtx = fx.getContext("2d")!;
    this.hitCtx = document.createElement("canvas").getContext("2d")!;
    this.wrap = world.wrapX;
    this.bounds = world.bounds;
    this.cam = { x: 10, y: -20, scale: 4 };
    this.hatch = makePattern((c, s) => {
      c.strokeStyle = "rgba(90, 64, 30, 0.22)";
      c.lineWidth = 1;
      for (let i = -s; i < s * 2; i += 6) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i + s, s);
        c.stroke();
      }
    }, 48);
    this.grain = makePattern((c, s) => {
      const img = c.createImageData(s, s);
      let x = 12345;
      for (let i = 0; i < img.data.length; i += 4) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        const v = 128 + ((x >> 16) % 60) - 30;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 26;
      }
      c.putImageData(img, 0, 0);
    }, 128);
    if (texture) return;
    const loop = (): void => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Texture mode: draw one frame. Returns true when the base layer was redrawn. */
  renderFrame(): boolean {
    return this.frame();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(width: number, height: number, dpr: number): void {
    const first = this.width <= 1;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.fxDpr = this.texture ? dpr / 2 : dpr;
    for (const [c, r] of [[this.base, this.dpr], [this.fx, this.fxDpr]] as const) {
      c.width = Math.round(width * r);
      c.height = Math.round(height * r);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }
    if (first) {
      this.sized = true;
      this.fitWorld();
      if (this.pendingFly !== null) {
        const { id, scale } = this.pendingFly;
        this.pendingFly = null;
        this.flyTo(id, scale);
      }
    }
    this.clampCamera(this.cam);
    this.dirty = true;
  }

  private minScale(): number {
    const h = this.bounds.maxY - this.bounds.minY;
    return Math.max(this.width / 360, this.height / (h + 10)) * 0.9;
  }

  private pendingFly: { id: AreaId; scale: number } | null = null;

  fitWorld(): void {
    if (this.texture) {
      this.cam = { x: 0, y: 0, scale: this.width / 360 };
      this.dirty = true;
      return;
    }
    const h = this.bounds.maxY - this.bounds.minY;
    this.target = null;
    this.cam = { x: 15, y: (this.bounds.minY + this.bounds.maxY) / 2 + 4, scale: Math.max(this.width / 300, this.height / (h + 6)) };
    this.clampCamera(this.cam);
    this.dirty = true;
  }

  setModel(model: MapModel): void {
    this.model = model;
    this.dirty = true;
  }

  setHover(id: AreaId | null): void {
    this.hover = id;
  }

  // ---- camera -------------------------------------------------------------

  private clampCamera(c: Camera): void {
    if (this.texture) return;
    c.scale = Math.min(80, Math.max(this.minScale(), c.scale));
    const halfH = this.height / 2 / c.scale;
    const top = this.bounds.minY - 6;
    const bottom = this.bounds.maxY + 6;
    if (bottom - top < halfH * 2) c.y = (top + bottom) / 2;
    else c.y = Math.min(bottom - halfH, Math.max(top + halfH, c.y));
    if (this.wrap !== undefined) {
      const centre = (this.bounds.minX + this.bounds.maxX) / 2;
      c.x = centre + ((((c.x - centre + this.wrap / 2) % this.wrap) + this.wrap) % this.wrap) - this.wrap / 2;
    }
  }

  toWorld(sx: number, sy: number): Point {
    return { x: this.cam.x + (sx - this.width / 2) / this.cam.scale, y: this.cam.y + (sy - this.height / 2) / this.cam.scale };
  }

  toScreen(p: Point): Point {
    return { x: (p.x - this.cam.x) * this.cam.scale + this.width / 2, y: (p.y - this.cam.y) * this.cam.scale + this.height / 2 };
  }

  panBy(dx: number, dy: number): void {
    this.target = null;
    this.cam.x -= dx / this.cam.scale;
    this.cam.y -= dy / this.cam.scale;
    this.clampCamera(this.cam);
    this.dirty = true;
  }

  fling(vx: number, vy: number): void {
    this.velocity = { x: vx, y: vy };
  }

  stopFling(): void {
    this.velocity = { x: 0, y: 0 };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.target = null;
    const before = this.toWorld(sx, sy);
    this.cam.scale *= factor;
    this.clampCamera(this.cam);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCamera(this.cam);
    this.dirty = true;
  }

  /** Glide the camera to an area, zooming in a little if far out. */
  flyTo(id: AreaId, minScale = 9): void {
    const g = this.geo.get(id);
    if (!g) return;
    if (!this.sized) {
      this.pendingFly = { id, scale: minScale };
      return;
    }
    const near = nearestCopy({ x: this.cam.x, y: this.cam.y }, g.center, this.wrap);
    this.target = { x: near.x, y: near.y, scale: Math.max(this.cam.scale, minScale) };
  }

  // ---- hit testing ----------------------------------------------------------

  hitTest(sx: number, sy: number): AreaId | null {
    const p = this.toWorld(sx, sy);
    const copies = this.wrap === undefined ? [0] : [0, -this.wrap, this.wrap];
    for (const off of copies) {
      const x = p.x - off;
      for (const g of this.geo.values()) {
        if (x < g.minX || x > g.maxX || p.y < g.minY || p.y > g.maxY) continue;
        if (this.hitCtx.isPointInPath(g.path, x, p.y)) return g.id;
      }
    }
    return null;
  }

  // ---- effects --------------------------------------------------------------

  addEffect(e: EffectInput, delay: number): void {
    const duration = e.kind === "battle" ? 2200 : e.kind === "capture" ? 1600 : 1400;
    this.effects.push({ ...e, start: performance.now() + delay, duration, seed: (this.seed += 1) });
  }

  // ---- drawing --------------------------------------------------------------

  private copies(): number[] {
    if (this.wrap === undefined) return [0];
    const left = this.cam.x - this.width / 2 / this.cam.scale;
    const right = this.cam.x + this.width / 2 / this.cam.scale;
    const out: number[] = [];
    for (let k = -2; k <= 2; k += 1) {
      const off = k * this.wrap;
      if (this.bounds.maxX + off >= left && this.bounds.minX + off <= right) out.push(off);
    }
    return out;
  }

  private worldTransform(ctx: CanvasRenderingContext2D, off: number, dpr = this.dpr): void {
    const s = this.cam.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (this.width / 2 - (this.cam.x - off) * this.cam.scale) * dpr, (this.height / 2 - this.cam.y * this.cam.scale) * dpr);
  }

  private frame(): boolean {
    const now = performance.now();
    if (this.target) {
      const t = this.target;
      const k = 0.12;
      const dx = t.x - this.cam.x;
      this.cam.x += dx * k;
      this.cam.y += (t.y - this.cam.y) * k;
      this.cam.scale += (t.scale - this.cam.scale) * k;
      if (Math.abs(dx) < 0.05 && Math.abs(t.scale - this.cam.scale) < 0.05) this.target = null;
      this.clampCamera(this.cam);
      this.dirty = true;
    }
    if (Math.abs(this.velocity.x) + Math.abs(this.velocity.y) > 0.05) {
      this.cam.x -= this.velocity.x / this.cam.scale;
      this.cam.y -= this.velocity.y / this.cam.scale;
      this.velocity.x *= 0.92;
      this.velocity.y *= 0.92;
      this.clampCamera(this.cam);
      this.dirty = true;
    }
    const redraw = this.dirty;
    if (redraw) {
      this.drawBase();
      this.dirty = false;
    }
    this.drawFx(now);
    return redraw;
  }

  private fillFor(st: AreaState): string {
    if (st.owner === null) return PARCHMENT;
    const c = this.model?.colors.get(String(st.owner)) ?? "#888888";
    return mix(c, "#efe3c4", 0.18);
  }

  private drawBase(): void {
    const ctx = this.baseCtx;
    const model = this.model;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    if (!model) return;
    const px = 1 / this.cam.scale;
    const offs = this.copies();
    const viewLeft = this.cam.x - this.width / 2 / this.cam.scale;
    const viewRight = this.cam.x + this.width / 2 / this.cam.scale;
    const viewTop = this.cam.y - this.height / 2 / this.cam.scale;
    const viewBottom = this.cam.y + this.height / 2 / this.cam.scale;
    const visible = (g: AreaGeometry, off: number): boolean =>
      g.maxX + off >= viewLeft && g.minX + off <= viewRight && g.maxY >= viewTop && g.minY <= viewBottom;

    for (const off of offs) {
      this.worldTransform(ctx, off);
      // Soft light along every coast, then the land itself. (The globe paints the
      // glow once into its sea instead: a blur over the whole world is slow.)
      ctx.save();
      if (!this.texture) {
        ctx.shadowColor = "rgba(255, 236, 190, 0.35)";
        ctx.shadowBlur = 10 * this.dpr;
      }
      ctx.fillStyle = PARCHMENT;
      for (const g of this.geo.values()) if (visible(g, off)) ctx.fill(g.path);
      ctx.restore();

      for (const g of this.geo.values()) {
        if (!visible(g, off)) continue;
        const st = model.areas[String(g.id)];
        if (!st) continue;
        ctx.fillStyle = this.fillFor(st);
        ctx.fill(g.path);
        if (st.owner === null) {
          const pat = ctx.createPattern(this.hatch, "repeat");
          if (pat) {
            pat.setTransform(new DOMMatrix().scale(px));
            ctx.fillStyle = pat;
            ctx.fill(g.path);
          }
        }
      }

      // Paper grain over all land.
      const grain = ctx.createPattern(this.grain, "repeat");
      if (grain) {
        grain.setTransform(new DOMMatrix().scale(px));
        ctx.fillStyle = grain;
        for (const g of this.geo.values()) if (visible(g, off)) ctx.fill(g.path);
      }

      // Thin borders between all areas.
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8 * px;
      for (const g of this.geo.values()) if (visible(g, off)) ctx.stroke(g.path);

      // A strong inner edge in each empire's colour so territories read as blocs.
      for (const g of this.geo.values()) {
        if (!visible(g, off)) continue;
        const st = model.areas[String(g.id)];
        if (!st || st.owner === null) continue;
        const c = model.colors.get(String(st.owner)) ?? "#888888";
        ctx.save();
        ctx.clip(g.path);
        ctx.strokeStyle = mix(c, "#1a1008", 0.45);
        ctx.lineWidth = 3.2 * px;
        ctx.stroke(g.path);
        ctx.restore();
      }
    }

    // Markers and labels in screen space so they stay crisp at any zoom.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const showNames = this.texture || this.cam.scale > 7.5;
    for (const off of offs) {
      for (const g of this.geo.values()) {
        if (!visible(g, off)) continue;
        const st = model.areas[String(g.id)];
        if (!st) continue;
        const p = this.toScreen({ x: g.center.x + off, y: g.center.y });
        this.drawMarkers(ctx, st, model, p, showNames ? model.names.get(g.id) ?? "" : "", g);
      }
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, st: AreaState, model: MapModel, p: Point, name: string, g: AreaGeometry): void {
    const view = model.perceive(st.id);
    const color = st.owner === null ? null : model.colors.get(String(st.owner)) ?? "#888";
    const big = this.cam.scale * Math.sqrt(g.size) > 26;
    let y = p.y;
    if (name && big) {
      ctx.font = `600 ${Math.min(15, 9 + this.cam.scale * 0.25)}px "Cormorant Garamond", Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = st.owner === null ? "rgba(245, 235, 210, 0.85)" : "rgba(20, 14, 8, 0.65)";
      ctx.fillStyle = st.owner === null ? "#3a2a16" : "#fff8e6";
      ctx.strokeText(name.toUpperCase(), p.x, y - 15);
      ctx.fillText(name.toUpperCase(), p.x, y - 15);
    }

    // Supply centre: a gold star; fortress: a small tower.
    const icons: string[] = [];
    if (st.supplyCenterOf !== null && st.owner === st.supplyCenterOf) icons.push("star");
    if (st.fortified) icons.push("fort");

    const known = view.kind !== "unknown";
    const n = view.kind === "unknown" ? 0 : view.troops;
    const stale = view.kind === "report";
    let label = known ? troopsLabel(n) : st.owner === model.me ? "" : "?";
    if (stale) label = `~${label}`;
    if (!label && icons.length === 0) return;
    // Zoomed out, unknown garrisons are just a faint dot so the map stays readable.
    if (!known && icons.length === 0 && !big) {
      ctx.beginPath();
      ctx.arc(p.x, y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(70, 50, 26, 0.45)";
      ctx.fill();
      return;
    }

    ctx.font = `700 11px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.max(22, ctx.measureText(label).width + 12) + icons.length * 13;
    const h = 17;
    const x0 = p.x - w / 2;
    const y0 = y - h / 2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 8.5);
    ctx.fillStyle = color ? mix(color, "#120c06", 0.35) : known ? "rgba(70, 50, 26, 0.88)" : "rgba(70, 50, 26, 0.55)";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = st.owner === model.me && model.me !== null ? "#f3d78a" : "rgba(255, 240, 210, 0.35)";
    ctx.stroke();
    let ix = x0 + 9;
    for (const icon of icons) {
      if (icon === "star") this.star(ctx, ix, y, 5.2, "#ffd76a");
      else this.tower(ctx, ix, y, "#e8dcc0");
      ix += 13;
    }
    ctx.fillStyle = stale ? "rgba(255, 245, 225, 0.7)" : "#fff6e2";
    ctx.fillText(label, x0 + (icons.length * 13) + (w - icons.length * 13) / 2, y + 0.5);

    const fleets = view.kind === "unknown" ? 0 : view.fleets;
    if (fleets > 0) {
      y += 15;
      const t = `⚓ ${fleets}`;
      const fw = ctx.measureText(t).width + 10;
      ctx.beginPath();
      ctx.roundRect(p.x - fw / 2, y - 7, fw, 14, 7);
      ctx.fillStyle = "rgba(14, 42, 64, 0.9)";
      ctx.fill();
      ctx.fillStyle = "#bfe3ff";
      ctx.font = `600 10px Inter, system-ui, sans-serif`;
      ctx.fillText(t, p.x, y + 0.5);
    }
  }

  private star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  private tower(ctx: CanvasRenderingContext2D, cx: number, cy: number, fill: string): void {
    ctx.fillStyle = fill;
    ctx.fillRect(cx - 4, cy - 2, 8, 6);
    for (let i = 0; i < 3; i += 1) ctx.fillRect(cx - 4 + i * 3, cy - 5, 2, 3);
  }

  private centre(id: AreaId): Point | null {
    return this.geo.get(id)?.center ?? null;
  }

  private drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, sea: boolean, now: number, label: string): void {
    const bb = nearestCopy(a, b, this.wrap);
    const c = arcControl(a, bb, sea ? 0.32 : 0.18);
    const sa = this.toScreen(a);
    const sb = this.toScreen(bb);
    const sc = this.toScreen(c);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(10, 6, 2, 0.45)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.quadraticCurveTo(sc.x, sc.y, sb.x, sb.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(sea ? [2, 7] : [10, 6]);
    ctx.lineDashOffset = -now / 40;
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead along the curve's end tangent.
    const tx = sb.x - sc.x;
    const ty = sb.y - sc.y;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    ctx.beginPath();
    ctx.moveTo(sb.x, sb.y);
    ctx.lineTo(sb.x - ux * 12 - uy * 6, sb.y - uy * 12 + ux * 6);
    ctx.lineTo(sb.x - ux * 12 + uy * 6, sb.y - uy * 12 - ux * 6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (label) {
      const m = quadPoint(sa, sc, sb, 0.5);
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(label).width + 10;
      ctx.beginPath();
      ctx.roundRect(m.x - w / 2, m.y - 8, w, 16, 8);
      ctx.fillStyle = "rgba(16, 12, 6, 0.85)";
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(label, m.x, m.y + 0.5);
    }
    ctx.restore();
  }

  private outline(ctx: CanvasRenderingContext2D, id: AreaId, style: string, width: number, fill?: string, dash?: number[], dashOffset = 0): void {
    const g = this.geo.get(id);
    if (!g) return;
    for (const off of this.copies()) {
      this.worldTransform(ctx, off, this.fxDpr);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill(g.path);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width / this.cam.scale;
      if (dash) {
        ctx.setLineDash(dash.map((d) => d / this.cam.scale));
        ctx.lineDashOffset = dashOffset / this.cam.scale;
      }
      ctx.stroke(g.path);
      ctx.setLineDash([]);
    }
    ctx.setTransform(this.fxDpr, 0, 0, this.fxDpr, 0, 0);
  }

  private drawFx(now: number): void {
    const ctx = this.fxCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    const model = this.model;
    if (!model) return;
    ctx.setTransform(this.fxDpr, 0, 0, this.fxDpr, 0, 0);
    ctx.lineJoin = "round";
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);

    for (const t of model.targets) {
      this.outline(ctx, t, `rgba(243, 215, 138, ${0.55 + 0.35 * pulse})`, 1.6, `rgba(243, 215, 138, ${0.1 + 0.12 * pulse})`);
    }
    if (this.hover !== null && this.hover !== model.selected) {
      this.outline(ctx, this.hover, "rgba(255, 250, 235, 0.9)", 1.6, "rgba(255, 250, 235, 0.08)");
    }
    if (model.selected !== null) {
      this.outline(ctx, model.selected, "rgba(20, 12, 4, 0.8)", 6);
      this.outline(ctx, model.selected, "#f3d78a", 2.6, undefined, [8, 6], -now / 30);
    }
    if (model.moveTo !== null) this.outline(ctx, model.moveTo, "#ffffff", 2.4, "rgba(255,255,255,0.12)");

    // Marching orders: everyone's moves are shown once ordered (they are public
    // in the combat phase anyway); yours are bright.
    for (const m of model.pending) {
      const a = this.centre(m.from);
      const b = this.centre(m.to);
      if (!a || !b) continue;
      const mine = String(m.power) === model.me;
      if (!mine) continue;
      const color = model.colors.get(String(m.power)) ?? "#fff";
      const label = m.bySea ? `⚓${m.fleets}${m.troops ? ` · ${troopsLabel(m.troops)}` : ""}` : troopsLabel(m.troops);
      for (const off of this.copies()) {
        this.drawArrow(ctx, { x: a.x + off, y: a.y }, { x: b.x + off, y: b.y }, mix(color, "#ffffff", 0.35), m.bySea, now, label);
      }
    }
    if (model.moveFrom !== null && model.moveTo !== null) {
      const a = this.centre(model.moveFrom);
      const b = this.centre(model.moveTo);
      if (a && b) {
        for (const off of this.copies()) this.drawArrow(ctx, { x: a.x + off, y: a.y }, { x: b.x + off, y: b.y }, "#f3d78a", model.moveMode === "fleet", now, "");
      }
    }

    // One-shot effects.
    this.effects = this.effects.filter((e) => now < e.start + e.duration);
    for (const e of this.effects) {
      const t = (now - e.start) / e.duration;
      if (t < 0) continue;
      const c = this.centre(e.area);
      if (!c) continue;
      for (const off of this.copies()) {
        const p = this.toScreen({ x: c.x + off, y: c.y });
        if (p.x < -100 || p.x > this.width + 100 || p.y < -100 || p.y > this.height + 100) continue;
        switch (e.kind) {
          case "battle":
            this.battleFx(ctx, e, t, { x: c.x + off, y: c.y }, p);
            break;
          case "capture":
            this.outline(ctx, e.area, rgba(e.color, 1 - t), 3 + 6 * (1 - t), rgba(e.color, 0.55 * (1 - t)));
            this.ring(ctx, p, 10 + 70 * t, rgba(e.color, 1 - t), 3);
            break;
          case "coins":
            this.sparkle(ctx, p, t, "#ffd76a", e.seed);
            break;
          case "spy":
            this.ring(ctx, p, 8 + 40 * t, `rgba(160, 220, 255, ${1 - t})`, 2);
            this.ring(ctx, p, 8 + 26 * t, `rgba(160, 220, 255, ${0.7 * (1 - t)})`, 1);
            break;
          case "build":
            this.ring(ctx, p, 6 + 30 * t, `rgba(243, 215, 138, ${1 - t})`, 2.5);
            this.sparkle(ctx, p, t, "#f3d78a", e.seed);
            break;
        }
      }
    }
  }

  private ring(ctx: CanvasRenderingContext2D, p: Point, r: number, color: string, width: number): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private sparkle(ctx: CanvasRenderingContext2D, p: Point, t: number, color: string, seed: number): void {
    for (let i = 0; i < 12; i += 1) {
      const a = ((i * 137.5 + seed * 31) % 360) * (Math.PI / 180);
      const d = 6 + t * (24 + ((i * 7 + seed) % 14));
      ctx.globalAlpha = Math.max(0, 1 - t);
      this.star(ctx, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d - t * 14, 2.6, color);
    }
    ctx.globalAlpha = 1;
  }

  /** Attack arcs fly in, then a burst of fire, smoke and a ring in the winner's colour. */
  private battleFx(ctx: CanvasRenderingContext2D, e: Effect, t: number, target: Point, p: Point): void {
    const travel = 0.35;
    for (const f of e.from) {
      const a0 = this.centre(f);
      if (!a0) continue;
      const a = nearestCopy(target, a0, this.wrap);
      const c = arcControl(a, target, e.bySea ? 0.3 : 0.16);
      const k = Math.min(1, t / travel);
      const sa = this.toScreen(a);
      const sc = this.toScreen(c);
      const sb = this.toScreen(target);
      ctx.save();
      ctx.globalAlpha = t < travel ? 1 : Math.max(0, 1 - (t - travel) * 3);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      const steps = 24;
      for (let i = 0; i <= steps * k; i += 1) {
        const q = quadPoint(sa, sc, sb, i / steps);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      const head = quadPoint(sa, sc, sb, k);
      ctx.fillStyle = "#fff4d0";
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (t < travel) return;
    const b = (t - travel) / (1 - travel);
    // Smoke.
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + e.seed;
      const d = 8 + b * 26;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.6 - b * 12, 7 + b * 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 54, 48, ${0.45 * (1 - b)})`;
      ctx.fill();
    }
    // Fire flashes.
    for (let i = 0; i < 5; i += 1) {
      const phase = (b * 5 + i * 0.37) % 1;
      const a = (e.seed * 13 + i * 71) % 360;
      const d = 4 + ((i * 11 + e.seed) % 16);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16 * (1 - phase));
      g.addColorStop(0, `rgba(255, 245, 200, ${(1 - b) * 0.95})`);
      g.addColorStop(0.4, `rgba(255, 150, 40, ${(1 - b) * 0.7})`);
      g.addColorStop(1, "rgba(255, 80, 20, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 16 * (1 - phase), 0, Math.PI * 2);
      ctx.fill();
    }
    this.ring(ctx, p, 10 + b * 46, e.won ? rgba(e.color, 1 - b) : `rgba(255, 255, 255, ${1 - b})`, 3);
    if (!e.won && b > 0.2) {
      // A white shield: the defence held.
      ctx.globalAlpha = Math.max(0, 1 - b);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 12);
      ctx.lineTo(p.x + 10, p.y - 7);
      ctx.quadraticCurveTo(p.x + 9, p.y + 8, p.x, p.y + 13);
      ctx.quadraticCurveTo(p.x - 9, p.y + 8, p.x - 10, p.y - 7);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
