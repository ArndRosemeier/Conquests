import * as THREE from "three";
import type { AreaId } from "../../engine/types.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import { worldGeometry } from "./geometry.ts";
import type { AreaGeometry } from "./geometry.ts";
import { ArcLayer, atmosphere, nearestAngle, stars, toVec, yawFacing } from "./globeKit.ts";
import { MapRenderer } from "./renderer.ts";
import { easeInOut, wrapPoint } from "./wrap.ts";
import type { EffectInput, MapModel } from "./renderer.ts";

/** Flat texture size in CSS px: 360 degrees across, 180 down. */
const FLAT_W = 2048;
const FLAT_H = 1024;
const MIN_DIST = 1.75;
const MAX_DIST = 6;
const MAX_TILT = 1.25;
/** Seconds without input before the globe starts turning by itself. */
const IDLE = 10;
/** Seconds for the map to wrap onto the globe, or to unwrap. */
const WRAP_TIME = 1.0;
/** Camera distance of the plain globe view. */
const HOME_DIST = 4.2;

/**
 * The game world on a turning globe. The flat map renderer draws the whole
 * world (land, markers, labels, selection glows, arrows) into two offscreen
 * canvases that are wrapped around the sphere: one for the land, redrawn
 * when the game changes, and a half-resolution one for animation, refreshed
 * every frame.
 * Battles turn the globe to face them and fly in as arcs.
 *
 * It offers the same methods as `MapRenderer`, so the map component drives
 * either view with the same pointer handling.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private readonly pivot = new THREE.Group();
  private readonly earth: THREE.Mesh;
  private readonly overlay: THREE.Mesh;
  private readonly flat: MapRenderer;
  private readonly baseCanvas = document.createElement("canvas");
  private readonly fxCanvas = document.createElement("canvas");
  private readonly land: HTMLCanvasElement;
  private readonly landCtx: CanvasRenderingContext2D;
  private readonly sea: HTMLCanvasElement;
  private readonly landTex: THREE.CanvasTexture;
  private readonly animTex: THREE.CanvasTexture;
  private readonly arcs: ArcLayer;
  private readonly geo: Map<AreaId, AreaGeometry>;
  private readonly ray = new THREE.Raycaster();
  private readonly timers = new Set<number>();
  private width = 1;
  private height = 1;
  private raf = 0;
  private last = performance.now();
  private lastInput = -Infinity;
  private yaw = yawFacing(15);
  private tilt = 0.5;
  private dist = 4.2;
  private target: { yaw: number; tilt: number; dist: number; speed: number } | null = null;
  private velocity = { yaw: 0, tilt: 0 };
  private model: MapModel | null = null;
  private readonly atmo: THREE.Mesh;
  private readonly bounds: WorldDefinition["bounds"];
  /** 0 = the flat sheet, 1 = the globe. */
  private wrapP = 1;
  private wrapGoal = 1;
  /** Unwrapping waits until the globe has turned to face the map's centre. */
  private aligning = false;
  private onFlat: ((done: boolean) => void) | null = null;

  /** `wrapIn`: start as the flat map and wrap it onto the globe. */
  constructor(canvas: HTMLCanvasElement, world: WorldDefinition, wrapIn = false) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.geo = worldGeometry(world);

    // 4096 texels across where the GPU allows it, so labels stay sharp up close.
    const texW = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    const scale = texW / FLAT_W;
    this.flat = new MapRenderer(this.baseCanvas, this.fxCanvas, world, true);
    this.flat.resize(FLAT_W, FLAT_H, scale);

    this.sea = paintSea(texW, texW / 2, this.geo);
    this.land = document.createElement("canvas");
    this.land.width = texW;
    this.land.height = texW / 2;
    this.landCtx = this.land.getContext("2d")!;

    this.landTex = new THREE.CanvasTexture(this.land);
    this.landTex.colorSpace = THREE.SRGBColorSpace;
    this.landTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.animTex = new THREE.CanvasTexture(this.fxCanvas);
    this.animTex.colorSpace = THREE.SRGBColorSpace;

    this.camera.position.set(0, 0, this.dist);
    this.scene.add(this.pivot);
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 120),
      new THREE.MeshPhongMaterial({ map: this.landTex, shininess: 14, specular: new THREE.Color("#1e2a40") }),
    );
    this.overlay = new THREE.Mesh(
      new THREE.SphereGeometry(1.002, 160, 120),
      new THREE.MeshBasicMaterial({ map: this.animTex, transparent: true, depthWrite: false }),
    );
    this.earth.add(this.overlay);
    this.pivot.add(this.earth);
    this.arcs = new ArcLayer(this.earth);
    this.atmo = atmosphere();
    this.scene.add(this.atmo, stars());
    this.bounds = world.bounds;
    if (wrapIn) {
      this.wrapP = 0;
      this.yaw = yawFacing(0);
      this.tilt = 0;
      this.applyWrap();
    }

    // Even light so the empires' colours read true; a soft sun gives the sphere its shape.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.4);
    sun.position.set(-3, 2, 4);
    this.scene.add(sun);

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---- wrapping -------------------------------------------------------------

  /** True while the map is wrapping or unwrapping. */
  get wrapping(): boolean {
    return this.wrapP !== this.wrapGoal || this.aligning;
  }

  /**
   * Turn to face the map's centre and unwrap the globe into the flat map.
   * Resolves true once flat, false if `wrap` was called first.
   */
  unwrap(): Promise<boolean> {
    this.onFlat?.(false);
    this.velocity = { yaw: 0, tilt: 0 };
    this.wrapGoal = 0;
    if (this.wrapP === 1) {
      this.aligning = true;
      this.target = { yaw: nearestAngle(this.yaw, yawFacing(0)), tilt: 0, dist: HOME_DIST, speed: 0.2 };
    }
    return new Promise((done) => {
      this.onFlat = done;
    });
  }

  /** Wrap back onto the globe (after an unwrap was started). */
  wrap(): void {
    this.onFlat?.(false);
    this.onFlat = null;
    this.aligning = false;
    this.wrapGoal = 1;
  }

  // ---- the MapRenderer surface ---------------------------------------------

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setModel(model: MapModel): void {
    this.model = model;
    this.flat.setModel(model);
  }

  setHover(id: AreaId | null): void {
    this.flat.setHover(id);
  }

  /** Drag: turn the globe under the pointer. */
  panBy(dx: number, dy: number): void {
    if (this.wrapping) return;
    this.touch();
    const k = this.dragScale();
    this.yaw += dx * k;
    this.tilt = clampTilt(this.tilt + dy * k);
  }

  fling(vx: number, vy: number): void {
    if (this.wrapping) return;
    const k = this.dragScale();
    this.velocity = { yaw: vx * k, tilt: vy * k };
  }

  stopFling(): void {
    this.velocity = { yaw: 0, tilt: 0 };
    if (this.wrapping) return;
    this.touch();
  }

  zoomAt(_sx: number, _sy: number, factor: number): void {
    if (this.wrapping) return;
    this.touch();
    const dist = clampDist(this.dist / factor);
    if (this.target) this.target.dist = dist;
    this.dist = dist;
  }

  /** Back out to see a whole hemisphere. */
  fitWorld(): void {
    if (this.wrapping) return;
    this.touch();
    this.target = { yaw: this.yaw, tilt: 0.45, dist: HOME_DIST, speed: 0.08 };
  }

  /** Turn an area to face the viewer. */
  flyTo(id: AreaId, closer = 3.4, speed = 0.07): void {
    const g = this.geo.get(id);
    if (!g || this.wrapGoal === 0) return;
    this.target = {
      yaw: nearestAngle(this.yaw, yawFacing(g.center.x)),
      tilt: clampTilt((-g.center.y * Math.PI) / 180),
      dist: Math.min(this.dist, closer),
      speed,
    };
  }

  hitTest(sx: number, sy: number): AreaId | null {
    const ndc = new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.earth, false)[0];
    if (!hit?.uv) return null;
    return this.flat.hitTest(hit.uv.x * FLAT_W, (1 - hit.uv.y) * FLAT_H);
  }

  /** Effects draw on the surface as on the flat map; battles also turn the globe and fly in as arcs. */
  addEffect(e: EffectInput, delay: number): void {
    this.flat.addEffect(e, delay);
    if (e.kind !== "battle" && e.kind !== "capture") return;
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      const at = this.unit(e.area);
      if (!at) return;
      if (e.kind === "capture") {
        this.arcs.pulse(at, e.color, 0.3);
        return;
      }
      // Swing round to the battle quickly unless the player is turning the globe.
      if (performance.now() - this.lastInput > 1500) this.flyTo(e.area, 3.0, 0.11);
      for (const f of e.from) {
        const from = this.unit(f);
        if (from) this.arcs.attack(from, at, e.color, { width: 0.008, lift: e.bySea ? 1.5 : 1, flash: 0.34 });
      }
      if (e.from.length === 0) this.arcs.pulse(at, e.color, 0.3);
    }, delay);
    this.timers.add(t);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.onFlat?.(false);
    this.onFlat = null;
    for (const t of this.timers) window.clearTimeout(t);
    this.flat.destroy();
    this.arcs.dispose();
    this.landTex.dispose();
    this.animTex.dispose();
    this.earth.geometry.dispose();
    this.overlay.geometry.dispose();
    (this.earth.material as THREE.Material).dispose();
    (this.overlay.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  // ---- internals ------------------------------------------------------------

  /** Advance the wrap. Returns true while it is running. */
  private stepWrap(dt: number): boolean {
    if (this.aligning) return true;
    if (this.wrapP === this.wrapGoal) return false;
    const step = dt / WRAP_TIME;
    this.wrapP = this.wrapGoal > this.wrapP ? Math.min(this.wrapGoal, this.wrapP + step) : Math.max(this.wrapGoal, this.wrapP - step);
    if (this.wrapGoal === 0) {
      // Keep facing the map's centre while unwrapping.
      this.yaw = nearestAngle(this.yaw, yawFacing(0));
      this.tilt = 0;
    }
    this.applyWrap();
    if (this.wrapP === 0 && this.wrapGoal === 0) {
      const done = this.onFlat;
      this.onFlat = null;
      done?.(true);
    }
    return true;
  }

  /** Bend both sphere meshes to the current wrap. */
  private applyWrap(): void {
    const s = easeInOut(this.wrapP);
    for (const [mesh, radius] of [[this.earth, 1], [this.overlay, 1.002]] as const) {
      const g = mesh.geometry;
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const p = pos.array as Float32Array;
      const n = nor.array as Float32Array;
      for (let i = 0; i < uv.count; i += 1) wrapPoint(uv.getX(i), uv.getY(i), s, radius, p, i * 3, n);
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      g.computeBoundingSphere();
    }
    // The halo only belongs to a round world.
    const glow = Math.max(0, (s - 0.7) / 0.3);
    this.atmo.visible = glow > 0;
    this.atmo.scale.setScalar(0.85 + 0.15 * glow);
  }

  /**
   * The camera for the current wrap: at 0 it frames the flat sheet the way the
   * flat map frames the world, at 1 it is the usual globe camera.
   */
  private placeCamera(): void {
    const s = easeInOut(this.wrapP);
    if (s >= 1) {
      this.camera.position.set(0, 0, this.dist);
      return;
    }
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const h = this.bounds.maxY - this.bounds.minY;
    // Same framing as the flat map's whole-world view: 300 degrees across or the whole height.
    const byWidth = ((Math.PI * 2 * 300) / 360) / (2 * half * this.camera.aspect);
    const byHeight = ((Math.PI * (h + 6)) / 180) / (2 * half);
    const flatDist = 1 + Math.min(byWidth, byHeight);
    // The flat map sits a little south of the equator (map y grows southward).
    const flatY = (-((this.bounds.minY + this.bounds.maxY) / 2 + 4) * Math.PI) / 180;
    this.camera.position.set(0, flatY * (1 - s), flatDist + (this.dist - flatDist) * s);
  }

  private unit(id: AreaId): THREE.Vector3 | null {
    const g = this.geo.get(id);
    return g ? toVec(g.center.x, -g.center.y, 1) : null;
  }

  private touch(): void {
    this.lastInput = performance.now();
    this.target = null;
  }

  /** Radians per dragged pixel: the same ground speed under the finger at any zoom. */
  private dragScale(): number {
    const visible = 2 * (this.dist - 1) * Math.tan((this.camera.fov * Math.PI) / 360);
    return (visible / Math.max(1, this.height)) * 1.1;
  }

  private idle(now: number): boolean {
    const m = this.model;
    return now - this.lastInput > IDLE * 1000 && this.target === null && (m === null || (m.selected === null && m.moveFrom === null));
  }

  private loop(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    const wrapStep = this.stepWrap(dt);

    if (this.target && (!wrapStep || this.aligning)) {
      const t = this.target;
      const k = 1 - Math.pow(1 - t.speed, dt * 60);
      this.yaw += (t.yaw - this.yaw) * k;
      this.tilt += (t.tilt - this.tilt) * k;
      this.dist += (t.dist - this.dist) * k;
      const left = Math.abs(t.yaw - this.yaw) + Math.abs(t.tilt - this.tilt) + Math.abs(t.dist - this.dist);
      // Unwrapping only needs to be close: the sheet snaps the last bit straight.
      if (left < (this.aligning ? 0.03 : 0.002)) {
        if (this.aligning) this.dist = t.dist;
        this.target = null;
        this.aligning = false;
      }
    } else if (wrapStep) {
      // Hold still while the sheet curls; a flyTo asked for meanwhile waits.
    } else if (Math.abs(this.velocity.yaw) + Math.abs(this.velocity.tilt) > 1e-4) {
      this.yaw += this.velocity.yaw;
      this.tilt = clampTilt(this.tilt + this.velocity.tilt);
      const decay = Math.pow(0.92, dt * 60);
      this.velocity.yaw *= decay;
      this.velocity.tilt *= decay;
    } else if (this.idle(now)) {
      this.yaw += 0.035 * dt;
    }
    this.earth.rotation.y = this.yaw;
    this.pivot.rotation.x = this.tilt;
    this.placeCamera();

    if (this.flat.renderFrame()) {
      this.landCtx.drawImage(this.sea, 0, 0);
      this.landCtx.drawImage(this.baseCanvas, 0, 0, this.land.width, this.land.height);
      this.landTex.needsUpdate = true;
    }
    this.animTex.needsUpdate = true;
    this.arcs.update(now);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }
}

function clampTilt(t: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, t));
}

function clampDist(d: number): number {
  return Math.max(MIN_DIST, Math.min(MAX_DIST, d));
}

/** Deep ocean with a faint brass graticule and lit coasts, under the land. */
function paintSea(w: number, h: number, geo: Map<AreaId, AreaGeometry>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#0b1a33");
  grd.addColorStop(0.5, "#15365f");
  grd.addColorStop(1, "#0b1a33");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(214,178,107,0.14)";
  g.lineWidth = Math.max(1, w / 2048);
  for (let lon = 0; lon <= 360; lon += 15) {
    const x = (lon / 360) * w;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let lat = 0; lat <= 180; lat += 15) {
    const y = (lat / 180) * h;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // Soft light along every coast, as on the flat map.
  const sx = w / 360;
  const sy = h / 180;
  g.shadowColor = "rgba(255, 236, 190, 0.45)";
  g.shadowBlur = 10 * (w / 2048);
  g.fillStyle = "#d7c49b";
  for (const shift of [-360, 0, 360]) {
    g.setTransform(sx, 0, 0, sy, (180 + shift) * sx, 90 * sy);
    for (const a of geo.values()) g.fill(a.path);
  }
  return c;
}
