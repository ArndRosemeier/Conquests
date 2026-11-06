import * as THREE from "three";
import type { AreaState } from "../../engine/state/gameState.ts";
import type { AreaId } from "../../engine/types.ts";
import type { Point, WorldDefinition } from "../../engine/world/types.ts";
import { decorPath, worldGeometry } from "../map/geometry.ts";
import { ArcLayer, atmosphere, stars, toVec } from "../map/globeKit.ts";

const TEX_W = 2048;
const TEX_H = 1024;
const NEUTRAL = "#cbb68a";
const DECOR = "#8f8168";

/**
 * The title screen's spinning globe: territories painted in their owners'
 * colours onto a canvas texture, an atmosphere glow, stars, and attack arcs.
 */
export class Globe {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private readonly pivot = new THREE.Group();
  private readonly earth: THREE.Mesh;
  private readonly tex: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly geo;
  private readonly decor: Path2D | null;
  private readonly arcs: ArcLayer;
  private raf = 0;
  private last = performance.now();
  private spin = 0.06;
  private boost = 0;
  private dragging: { x: number; y: number } | null = null;
  private velocity = 0;
  private tilt = 0.32;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly world: WorldDefinition) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.geo = worldGeometry(world);
    this.decor = decorPath(world);

    this.camera.position.set(0, 0, 4.6);
    this.scene.add(this.pivot);
    this.pivot.rotation.x = this.tilt;

    const paint = document.createElement("canvas");
    paint.width = TEX_W;
    paint.height = TEX_H;
    this.ctx = paint.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(paint);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshPhongMaterial({ map: this.tex, shininess: 18, specular: new THREE.Color("#2a3a55") }),
    );
    this.earth.rotation.y = (-(20 + 90) * Math.PI) / 180; // start over Europe and Africa
    this.pivot.add(this.earth);

    this.scene.add(atmosphere(), stars());
    this.arcs = new ArcLayer(this.earth);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-3, 2, 4);
    this.scene.add(sun);

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Repaint the territories in their owners' colours. */
  paint(areas: Readonly<Record<string, AreaState>>, colors: ReadonlyMap<string, string>): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sea = g.createLinearGradient(0, 0, 0, TEX_H);
    sea.addColorStop(0, "#0b1a33");
    sea.addColorStop(0.5, "#123058");
    sea.addColorStop(1, "#0b1a33");
    g.fillStyle = sea;
    g.fillRect(0, 0, TEX_W, TEX_H);
    // Graticule.
    g.strokeStyle = "rgba(214,178,107,0.12)";
    g.lineWidth = 1;
    for (let lon = 0; lon <= 360; lon += 15) {
      const x = (lon / 360) * TEX_W;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TEX_H); g.stroke();
    }
    for (let lat = 0; lat <= 180; lat += 15) {
      const y = (lat / 180) * TEX_H;
      g.beginPath(); g.moveTo(0, y); g.lineTo(TEX_W, y); g.stroke();
    }
    const sx = TEX_W / 360;
    const sy = TEX_H / 180;
    for (const shift of [-360, 0, 360]) {
      g.setTransform(sx, 0, 0, sy, (180 + shift) * sx, 90 * sy);
      if (this.decor) {
        g.fillStyle = DECOR;
        g.fill(this.decor);
      }
      for (const [id, a] of this.geo) {
        const owner = areas[String(id)]?.owner ?? null;
        g.fillStyle = owner === null ? NEUTRAL : colors.get(String(owner)) ?? NEUTRAL;
        g.fill(a.path);
      }
      g.lineWidth = 0.14;
      g.strokeStyle = "rgba(25,18,10,0.75)";
      for (const a of this.geo.values()) g.stroke(a.path);
    }
    this.tex.needsUpdate = true;
  }

  private centre(id: AreaId): Point | null {
    return this.geo.get(id)?.center ?? null;
  }

  /** Draw an attack arc from one territory to another. */
  attack(from: AreaId, to: AreaId, color: string): void {
    const a = this.centre(from);
    const b = this.centre(to);
    if (!a || !b) return;
    this.arcs.attack(toVec(a.x, -a.y, 1), toVec(b.x, -b.y, 1), color);
  }

  /** Easter egg: a fast spin. */
  whirl(): void {
    this.boost = 9;
  }

  pointerDown(x: number, y: number): void {
    this.dragging = { x, y };
    this.velocity = 0;
  }

  pointerMove(x: number, y: number): void {
    if (!this.dragging) return;
    const dx = x - this.dragging.x;
    const dy = y - this.dragging.y;
    this.dragging = { x, y };
    this.earthSpin(dx * 0.006);
    this.velocity = dx * 0.006;
    this.tilt = Math.max(-0.9, Math.min(0.9, this.tilt + dy * 0.004));
  }

  pointerUp(): void {
    this.dragging = null;
  }

  private earthSpin(d: number): void {
    this.earth.rotation.y += d;
  }

  private loop(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) {
      this.velocity *= 0.95;
      this.boost *= 0.97;
      this.earthSpin((this.spin + this.boost) * dt + this.velocity);
    }
    this.pivot.rotation.x += (this.tilt - this.pivot.rotation.x) * 0.1;

    this.arcs.update(now);

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.arcs.dispose();
    this.tex.dispose();
    this.renderer.dispose();
    void this.world;
    void this.canvas;
  }
}
