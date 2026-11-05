import * as THREE from "three";
import type { AreaState } from "../../engine/state/gameState.ts";
import type { AreaId } from "../../engine/types.ts";
import type { Point, WorldDefinition } from "../../engine/world/types.ts";
import { worldGeometry } from "../map/geometry.ts";

const TEX_W = 2048;
const TEX_H = 1024;
const NEUTRAL = "#cbb68a";

/** Longitude/latitude (degrees) to a point on a sphere, matching three's sphere UVs. */
function toVec(lon: number, lat: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

interface Arc {
  readonly mesh: THREE.Mesh;
  readonly flash: THREE.Sprite;
  readonly total: number;
  readonly born: number;
  readonly color: THREE.Color;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,230,180,0.8)");
  grd.addColorStop(1, "rgba(255,180,80,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

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
  private readonly glow = glowTexture();
  private arcs: Arc[] = [];
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

    // Atmosphere: a back-facing shell with a fresnel glow.
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.09, 64, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "varying vec3 vN; void main(){ float i = pow(max(0.0, 0.66 - dot(vN, vec3(0.0,0.0,1.0))), 2.4); gl_FragColor = vec4(0.55,0.72,1.0,1.0)*i*0.9 + vec4(0.9,0.7,0.35,0.0)*i*0.25; }",
      }),
    );
    this.scene.add(atmo);

    // Stars.
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i += 1) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 20);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff1d6, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

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
    const va = toVec(a.x, -a.y, 1.0);
    const vb = toVec(b.x, -b.y, 1.0);
    const angle = va.angleTo(vb);
    const lift = 0.06 + angle * 0.22;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i += 1) {
      const t = i / 48;
      const v = new THREE.Vector3().copy(va).lerp(vb, t).normalize();
      // Slerp-ish: renormalising a lerp is fine for arcs shorter than a half-turn.
      v.multiplyScalar(1.004 + Math.sin(Math.PI * t) * lift);
      pts.push(v);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geom = new THREE.TubeGeometry(curve, 64, 0.0065, 6, false);
    const c = new THREE.Color(color);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
    geom.setDrawRange(0, 0);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    flash.position.copy(vb).multiplyScalar(1.01);
    flash.scale.setScalar(0.01);
    this.earth.add(mesh, flash);
    this.arcs.push({ mesh, flash, total: geom.index?.count ?? 0, born: performance.now(), color: c });
    if (this.arcs.length > 40) this.dropArc(this.arcs.shift()!);
  }

  private dropArc(a: Arc): void {
    this.earth.remove(a.mesh, a.flash);
    a.mesh.geometry.dispose();
    (a.mesh.material as THREE.Material).dispose();
    a.flash.material.dispose();
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

    const keep: Arc[] = [];
    for (const a of this.arcs) {
      const age = (now - a.born) / 1000;
      const grow = Math.min(1, age / 1.1);
      a.mesh.geometry.setDrawRange(0, Math.floor(a.total * (1 - Math.pow(1 - grow, 2)) / 3) * 3);
      const fade = age < 3 ? 1 : Math.max(0, 1 - (age - 3) / 2);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
      const hit = age - 1.0;
      if (hit > 0) {
        const p = Math.min(1, hit / 0.9);
        a.flash.material.opacity = (1 - p) * 1.2;
        a.flash.scale.setScalar(0.05 + p * 0.28);
      }
      if (fade > 0) keep.push(a);
      else this.dropArc(a);
    }
    this.arcs = keep;

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const a of this.arcs) this.dropArc(a);
    this.tex.dispose();
    this.glow.dispose();
    this.renderer.dispose();
    void this.world;
    void this.canvas;
  }
}
