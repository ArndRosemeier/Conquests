import * as THREE from "three";

/** Pieces shared by the title globe and the in-game globe. */

/** Longitude/latitude (degrees) to a point on a sphere, matching three's sphere UVs. */
export function toVec(lon: number, lat: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** The earth's y-rotation that turns a longitude to face the camera. */
export function yawFacing(lon: number): number {
  return Math.PI / 2 - ((lon + 180) * Math.PI) / 180;
}

/** `to` moved by whole turns so it is within half a turn of `from`. */
export function nearestAngle(from: number, to: number): number {
  const d = (((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return from + d;
}

export function glowTexture(): THREE.Texture {
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

/** A back-facing shell with a fresnel glow. */
export function atmosphere(): THREE.Mesh {
  return new THREE.Mesh(
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
}

export function stars(count = 1800): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 20);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff1d6, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
}

interface Arc {
  readonly mesh: THREE.Mesh;
  readonly flash: THREE.Sprite;
  readonly total: number;
  readonly born: number;
  readonly hitAt: number;
}

interface Pulse {
  readonly sprite: THREE.Sprite;
  readonly born: number;
  readonly size: number;
}

/**
 * Attack arcs that grow from one place to another and end in a flash, and
 * pulses that bloom on a place. Everything is added to `parent` (the earth),
 * so it turns with the globe.
 */
export class ArcLayer {
  private arcs: Arc[] = [];
  private pulses: Pulse[] = [];
  private readonly glow = glowTexture();

  constructor(private readonly parent: THREE.Object3D) {}

  /** `a` and `b` are unit vectors on the sphere. */
  attack(a: THREE.Vector3, b: THREE.Vector3, color: string, opts: { width?: number; lift?: number; flash?: number } = {}): void {
    const angle = a.angleTo(b);
    const lift = (opts.lift ?? 1) * (0.06 + angle * 0.22);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i += 1) {
      const t = i / 48;
      // Renormalising a lerp is fine for arcs shorter than a half-turn.
      const v = new THREE.Vector3().copy(a).lerp(b, t).normalize();
      v.multiplyScalar(1.004 + Math.sin(Math.PI * t) * lift);
      pts.push(v);
    }
    const geom = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, opts.width ?? 0.0065, 6, false);
    const c = new THREE.Color(color);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
    geom.setDrawRange(0, 0);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    flash.position.copy(b).multiplyScalar(1.01);
    flash.scale.setScalar(0.01);
    flash.userData.size = opts.flash ?? 0.28;
    this.parent.add(mesh, flash);
    this.arcs.push({ mesh, flash, total: geom.index?.count ?? 0, born: performance.now(), hitAt: 1.0 });
    if (this.arcs.length > 40) this.dropArc(this.arcs.shift()!);
  }

  /** A soft bloom of light on one place, e.g. a territory changing hands. */
  pulse(at: THREE.Vector3, color: string, size = 0.22): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    sprite.position.copy(at).multiplyScalar(1.012);
    this.parent.add(sprite);
    this.pulses.push({ sprite, born: performance.now(), size });
  }

  update(now: number): void {
    const keep: Arc[] = [];
    for (const a of this.arcs) {
      const age = (now - a.born) / 1000;
      const grow = Math.min(1, age / 1.1);
      a.mesh.geometry.setDrawRange(0, Math.floor((a.total * (1 - Math.pow(1 - grow, 2))) / 3) * 3);
      const fade = age < 3 ? 1 : Math.max(0, 1 - (age - 3) / 2);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
      const hit = age - a.hitAt;
      if (hit > 0) {
        const p = Math.min(1, hit / 0.9);
        a.flash.material.opacity = (1 - p) * 1.2;
        a.flash.scale.setScalar(0.05 + p * (a.flash.userData.size as number));
      }
      if (fade > 0) keep.push(a);
      else this.dropArc(a);
    }
    this.arcs = keep;

    const alive: Pulse[] = [];
    for (const p of this.pulses) {
      const t = (now - p.born) / 1400;
      if (t >= 1) {
        this.parent.remove(p.sprite);
        p.sprite.material.dispose();
        continue;
      }
      p.sprite.material.opacity = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      p.sprite.scale.setScalar(0.04 + p.size * Math.sqrt(t));
      alive.push(p);
    }
    this.pulses = alive;
  }

  private dropArc(a: Arc): void {
    this.parent.remove(a.mesh, a.flash);
    a.mesh.geometry.dispose();
    (a.mesh.material as THREE.Material).dispose();
    a.flash.material.dispose();
  }

  dispose(): void {
    for (const a of this.arcs) this.dropArc(a);
    for (const p of this.pulses) {
      this.parent.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.arcs = [];
    this.pulses = [];
    this.glow.dispose();
  }
}
