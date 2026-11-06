import { describe, expect, it } from "vitest";
import { wrapPoint } from "./wrap.ts";

/** Three's SphereGeometry vertex for the same UV (phi from u, theta from 1 - v). */
function sphere(u: number, v: number): [number, number, number] {
  const phi = u * Math.PI * 2;
  const theta = (1 - v) * Math.PI;
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
}

describe("map wrap", () => {
  it("lies on the unit sphere exactly where three puts it when fully wrapped", () => {
    for (const [u, v] of [[0.5, 0.5], [0.1, 0.3], [0.9, 0.8], [0.25, 0.5], [0.7, 0.05]] as const) {
      const out = [0, 0, 0];
      wrapPoint(u, v, 1, 1, out);
      const want = sphere(u, v);
      for (let k = 0; k < 3; k += 1) expect(out[k]).toBeCloseTo(want[k]!, 6);
    }
  });

  it("is a flat 2π × π sheet facing +x when unwrapped", () => {
    const out = [0, 0, 0];
    wrapPoint(1, 1, 0, 1, out);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(Math.PI / 2);
    expect(out[2]).toBeCloseTo(-Math.PI);
  });

  it("moves smoothly from nearly flat to flat", () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    wrapPoint(0.8, 0.6, 0, 1, a);
    wrapPoint(0.8, 0.6, 0.001, 1, b);
    for (let k = 0; k < 3; k += 1) expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(0.01);
  });

  it("keeps the front point fixed at every stage", () => {
    for (const s of [0, 0.2, 0.5, 1]) {
      const out = [0, 0, 0];
      wrapPoint(0.5, 0.5, s, 1, out);
      expect(out).toEqual([1, 0, -0]);
    }
  });
});
