import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEarth } from "../src/engine/world/earthSource.ts";
import { serializeWorld } from "../src/engine/world/earthSerialization.ts";

/**
 * Offline generator for the real-world map. Building the world clips 130+
 * Voronoi cells against a detailed coastline (~20s), so we do it here once and
 * write the result to a static JSON asset the app loads instantly.
 *
 * Run with: npm run gen:world  (executes via vite-node so JSON/coastline imports
 * resolve the same way they do in the app).
 */
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../src/engine/world/data/earth.generated.json");

const t0 = performance.now();
const world = buildEarth();
const serialized = serializeWorld(world);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(serialized));
const ms = (performance.now() - t0).toFixed(0);
const bytes = JSON.stringify(serialized).length;
console.log(
  `Generated ${world.areas.length} areas in ${ms}ms -> ${outPath} (${(bytes / 1024).toFixed(0)} KB)`,
);
