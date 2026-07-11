import { describe, expect, it } from "vitest";
import { areaId } from "./types.ts";
import { CLASSIC_WORLD, neighborsOf, portAreas } from "./world/classic.ts";

describe("classic world", () => {
  it("contains all 131 areas across 8 regions", () => {
    expect(CLASSIC_WORLD.areas).toHaveLength(131);
    expect(CLASSIC_WORLD.regions).toHaveLength(8);
  });

  it("has unique area ids and renderable geometry", () => {
    const ids = new Set(CLASSIC_WORLD.areas.map((a) => a.id));
    expect(ids.size).toBe(131);
    for (const area of CLASSIC_WORLD.areas) {
      expect(area.shape.length).toBeGreaterThan(0);
      for (const ring of area.shape) expect(ring.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("has symmetric adjacency", () => {
    for (const area of CLASSIC_WORLD.areas) {
      for (const n of neighborsOf(CLASSIC_WORLD, area.id)) {
        expect(neighborsOf(CLASSIC_WORLD, n)).toContain(area.id);
      }
    }
  });

  it("makes every area reachable (land neighbor or port)", () => {
    for (const area of CLASSIC_WORLD.areas) {
      const reachable = neighborsOf(CLASSIC_WORLD, area.id).length > 0 || area.isPort;
      expect(reachable).toBe(true);
    }
  });

  it("derives a healthy number of ports", () => {
    expect(portAreas(CLASSIC_WORLD).length).toBeGreaterThan(40);
  });

  it("honors the manual's special crossings", () => {
    expect(neighborsOf(CLASSIC_WORLD, areaId(42))).toContain(areaId(79));
    expect(neighborsOf(CLASSIC_WORLD, areaId(114))).toContain(areaId(116));
    expect(neighborsOf(CLASSIC_WORLD, areaId(82))).toContain(areaId(84));
  });
});
