import type { WorldDefinition } from "./types.ts";
import { deserializeWorld } from "./earthSerialization.ts";
import type { SerializedWorld } from "./earthSerialization.ts";
import earthJson from "./data/earth.generated.json?raw";

/**
 * The real Earth as a ready-to-use WorldDefinition.
 *
 * The geometry is derived from detailed country borders, too slow and too bulky
 * to do in the browser, so it is precomputed offline by
 * `scripts/generateEarth.ts` and shipped as a static JSON asset. This module
 * just parses and rehydrates it, giving instant startup and keeping the bulky
 * coastline data out of the client bundle. Re-run `npm run gen:world` after
 * changing site data or the builder to regenerate the asset.
 */
export const REAL_WORLD: WorldDefinition = {
  ...deserializeWorld(JSON.parse(earthJson) as SerializedWorld),
  // Equirectangular projection uses x = longitude, so the globe repeats every
  // 360 degrees; this enables seamless east-west wraparound in the viewer.
  wrapX: 360,
};
