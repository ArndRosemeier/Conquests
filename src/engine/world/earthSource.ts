import { areaId, regionId } from "../types.ts";
import type { AreaId } from "../types.ts";
import type { Rating, Region, WorldDefinition } from "./types.ts";
import { LAND_MASK } from "./geo/land.ts";
import { projectEquirectangular } from "./geo/geometry.ts";
import { buildWorldFromSites } from "./geo/worldBuilder.ts";
import type { WorldSite } from "./geo/worldBuilder.ts";

/**
 * Offline description of the real Earth as inputs to the generic Voronoi world
 * builder: each area gets a real longitude/latitude, the coastline comes from
 * the shared land mask, and the builder derives territory shapes, land
 * adjacency, and ports.
 *
 * Building this clips 130+ Voronoi cells against a detailed (50m) coastline,
 * which takes ~20s — far too slow to run in the browser on every load. So this
 * module is NOT imported by the app; a build-time script (`scripts/generateEarth.ts`)
 * runs `buildEarth()` once and serializes the result to JSON, which the runtime
 * `realWorld.ts` loads instantly. This same pipeline will build procedural
 * worlds at runtime, feeding synthetic sites and a synthetic land mask through
 * the exact same code.
 */

interface SiteSpec {
  readonly id: number;
  readonly name: string;
  readonly region: number;
  readonly lon: number;
  readonly lat: number;
  readonly value: Rating;
  readonly defense: Rating;
  readonly terrain?: number;
}

export const REAL_REGIONS: readonly Region[] = [
  { id: regionId(1), name: "North America", color: "#3b5ba5" },
  { id: regionId(2), name: "South America", color: "#2e8b57" },
  { id: regionId(3), name: "Europe", color: "#7d3c98" },
  { id: regionId(4), name: "North Africa", color: "#b9770e" },
  { id: regionId(5), name: "South Africa", color: "#a04000" },
  { id: regionId(6), name: "The Near East", color: "#1f8a8a" },
  { id: regionId(7), name: "The Far East", color: "#c0392b" },
  { id: regionId(8), name: "The South Pacific", color: "#16856a" },
];

const SITE_SPECS: readonly SiteSpec[] = [
  // Region 1 — North America
  { id: 1, name: "Alaska", region: 1, lon: -152, lat: 64, value: "D", defense: "D", terrain: 3 },
  { id: 2, name: "Western Territory", region: 1, lon: -123, lat: 59, value: "C", defense: "D" },
  { id: 3, name: "Alberta", region: 1, lon: -114, lat: 54, value: "C", defense: "D" },
  { id: 4, name: "Manitoba", region: 1, lon: -98, lat: 55, value: "C", defense: "D", terrain: 2 },
  { id: 5, name: "Ontario", region: 1, lon: -82, lat: 49, value: "C", defense: "D", terrain: 2 },
  { id: 6, name: "Hudson Bay", region: 1, lon: -85, lat: 60, value: "D", defense: "D" },
  { id: 7, name: "Quebec", region: 1, lon: -72, lat: 52, value: "B", defense: "D" },
  { id: 8, name: "Mexico", region: 1, lon: -102, lat: 23, value: "B", defense: "A" },
  { id: 9, name: "Cuba", region: 1, lon: -79, lat: 22, value: "C", defense: "B" },
  { id: 10, name: "Haiti", region: 1, lon: -72, lat: 19, value: "D", defense: "D", terrain: 1 },
  { id: 11, name: "Puerto Rico", region: 1, lon: -66, lat: 18, value: "D", defense: "D" },
  { id: 12, name: "Honduras", region: 1, lon: -87, lat: 15, value: "D", defense: "D" },
  { id: 13, name: "Nicaragua", region: 1, lon: -85, lat: 13, value: "C", defense: "D", terrain: 1 },
  { id: 14, name: "Costa Rica", region: 1, lon: -84, lat: 10, value: "C", defense: "D" },
  { id: 16, name: "Hawaii", region: 1, lon: -157, lat: 20, value: "C", defense: "D" },
  { id: 17, name: "E USA", region: 1, lon: -76, lat: 40, value: "A", defense: "A" },
  { id: 18, name: "S USA", region: 1, lon: -92, lat: 32, value: "A", defense: "C" },
  { id: 19, name: "N USA", region: 1, lon: -100, lat: 47, value: "C", defense: "D" },
  { id: 20, name: "W USA", region: 1, lon: -120, lat: 40, value: "A", defense: "C" },

  // Region 2 — South America
  { id: 15, name: "Galapagos Is.", region: 2, lon: -90, lat: 0, value: "D", defense: "D" },
  { id: 21, name: "Columbia", region: 2, lon: -74, lat: 4, value: "B", defense: "C", terrain: 2 },
  { id: 22, name: "Venezuela", region: 2, lon: -66, lat: 8, value: "C", defense: "C", terrain: 2 },
  { id: 23, name: "Guiana", region: 2, lon: -58, lat: 4, value: "D", defense: "D" },
  { id: 24, name: "Ecuador", region: 2, lon: -78, lat: -2, value: "D", defense: "D" },
  { id: 25, name: "Peru", region: 2, lon: -76, lat: -10, value: "C", defense: "C" },
  { id: 26, name: "Bolivia", region: 2, lon: -65, lat: -17, value: "B", defense: "D" },
  { id: 27, name: "Brazil", region: 2, lon: -40, lat: -8, value: "B", defense: "A" },
  { id: 28, name: "Paraguay", region: 2, lon: -58, lat: -23, value: "D", defense: "D" },
  { id: 29, name: "Uruguay", region: 2, lon: -56, lat: -33, value: "D", defense: "D" },
  { id: 30, name: "Chile", region: 2, lon: -71, lat: -35, value: "C", defense: "C" },
  { id: 31, name: "Argentina", region: 2, lon: -60, lat: -37, value: "B", defense: "B" },
  { id: 32, name: "Falkland Is.", region: 2, lon: -59, lat: -51, value: "C", defense: "D" },

  // Region 3 — Europe
  { id: 33, name: "Azores", region: 3, lon: -28, lat: 38, value: "C", defense: "D" },
  { id: 34, name: "Norway", region: 3, lon: 9, lat: 61, value: "B", defense: "D" },
  { id: 35, name: "Sweden", region: 3, lon: 15, lat: 62, value: "B", defense: "C" },
  { id: 36, name: "Iceland", region: 3, lon: -19, lat: 65, value: "D", defense: "D" },
  { id: 37, name: "Belgium", region: 3, lon: 4.5, lat: 50.8, value: "A", defense: "C" },
  { id: 38, name: "Portugal", region: 3, lon: -8, lat: 39.5, value: "C", defense: "C", terrain: 2 },
  { id: 39, name: "Spain", region: 3, lon: -4, lat: 40, value: "B", defense: "A", terrain: 3 },
  { id: 40, name: "Italy", region: 3, lon: 12.5, lat: 42, value: "A", defense: "A" },
  { id: 41, name: "Austria-Hungary", region: 3, lon: 16, lat: 47.5, value: "A", defense: "A" },
  { id: 42, name: "Balkans", region: 3, lon: 20, lat: 43.5, value: "A", defense: "B" },
  { id: 43, name: "Romania", region: 3, lon: 25, lat: 46, value: "B", defense: "A" },
  { id: 45, name: "Greece", region: 3, lon: 22, lat: 39, value: "B", defense: "B", terrain: 4 },
  { id: 46, name: "London", region: 3, lon: -1, lat: 52, value: "A", defense: "A" },
  { id: 47, name: "Scotland", region: 3, lon: -4, lat: 57, value: "A", defense: "D" },
  { id: 48, name: "Ireland", region: 3, lon: -8, lat: 53, value: "C", defense: "D" },
  { id: 49, name: "Paris", region: 3, lon: 2.3, lat: 48.5, value: "A", defense: "A" },
  { id: 50, name: "Normandy", region: 3, lon: 0, lat: 49, value: "A", defense: "D" },
  { id: 51, name: "Marseilles", region: 3, lon: 5.4, lat: 43.5, value: "A", defense: "D" },
  { id: 52, name: "Berlin", region: 3, lon: 13.4, lat: 52.5, value: "A", defense: "A" },
  { id: 53, name: "Ruhr", region: 3, lon: 7.5, lat: 51, value: "A", defense: "D" },
  { id: 54, name: "Prussia", region: 3, lon: 20.5, lat: 54, value: "A", defense: "D", terrain: 2 },
  { id: 94, name: "Ukraine", region: 3, lon: 32, lat: 49, value: "A", defense: "A", terrain: 3 },
  { id: 95, name: "Moscow", region: 3, lon: 37.6, lat: 55.75, value: "A", defense: "A" },

  // Region 4 — North Africa
  { id: 55, name: "Canary I.", region: 4, lon: -16, lat: 28, value: "C", defense: "D" },
  { id: 56, name: "Morocco", region: 4, lon: -7, lat: 32, value: "B", defense: "D" },
  { id: 58, name: "Algeria", region: 4, lon: 3, lat: 28, value: "D", defense: "D" },
  { id: 59, name: "Tunisia", region: 4, lon: 9, lat: 34, value: "C", defense: "D", terrain: 1 },
  { id: 60, name: "Libya", region: 4, lon: 17, lat: 27, value: "D", defense: "D", terrain: 2 },
  { id: 61, name: "Egypt", region: 4, lon: 30, lat: 26, value: "A", defense: "D", terrain: 2 },
  { id: 62, name: "Mauritania", region: 4, lon: -10, lat: 20, value: "C", defense: "D" },
  { id: 63, name: "Nigeria", region: 4, lon: 8, lat: 10, value: "D", defense: "D", terrain: 2 },
  { id: 64, name: "Equatorial Africa", region: 4, lon: 15, lat: 2, value: "D", defense: "D", terrain: 3 },
  { id: 65, name: "Sudan", region: 4, lon: 30, lat: 15, value: "D", defense: "D" },
  { id: 66, name: "Abyssinia", region: 4, lon: 39, lat: 9, value: "C", defense: "C" },
  { id: 67, name: "Somalia", region: 4, lon: 46, lat: 6, value: "B", defense: "D" },
  { id: 68, name: "East Africa", region: 4, lon: 36, lat: -4, value: "B", defense: "C" },
  { id: 69, name: "Congo", region: 4, lon: 23, lat: -3, value: "B", defense: "D" },

  // Region 5 — South Africa
  { id: 44, name: "Tristan da Cunha", region: 5, lon: -12, lat: -37, value: "D", defense: "D" },
  { id: 70, name: "Ascension Is.", region: 5, lon: -14, lat: -8, value: "D", defense: "D" },
  { id: 71, name: "St Helena", region: 5, lon: -5.7, lat: -16, value: "B", defense: "D" },
  { id: 72, name: "Angola", region: 5, lon: 18, lat: -12, value: "C", defense: "D" },
  { id: 73, name: "Rhodesia", region: 5, lon: 29, lat: -18, value: "C", defense: "D" },
  { id: 74, name: "S.W. Africa", region: 5, lon: 17, lat: -22, value: "C", defense: "D" },
  { id: 75, name: "Bechuanaland", region: 5, lon: 24, lat: -22, value: "C", defense: "D" },
  { id: 76, name: "Mozambique", region: 5, lon: 35, lat: -18, value: "C", defense: "D" },
  { id: 77, name: "Madagascar", region: 5, lon: 47, lat: -19, value: "B", defense: "D" },
  { id: 78, name: "The Cape", region: 5, lon: 23, lat: -31, value: "A", defense: "C" },

  // Region 6 — The Near East
  { id: 57, name: "Mauritius Is.", region: 6, lon: 57.5, lat: -20, value: "D", defense: "D" },
  { id: 79, name: "Ottoman Empire", region: 6, lon: 34, lat: 39, value: "A", defense: "A", terrain: 4 },
  { id: 80, name: "Persia", region: 6, lon: 53, lat: 32, value: "A", defense: "B" },
  { id: 81, name: "Arabia", region: 6, lon: 45, lat: 24, value: "D", defense: "C", terrain: 4 },
  { id: 82, name: "Afghanistan", region: 6, lon: 66, lat: 34, value: "B", defense: "C" },
  { id: 83, name: "Baluchistan", region: 6, lon: 64, lat: 28, value: "B", defense: "D" },
  { id: 84, name: "Punjab", region: 6, lon: 73, lat: 31, value: "C", defense: "D" },
  { id: 85, name: "Kashmir", region: 6, lon: 76, lat: 34, value: "C", defense: "D" },
  { id: 86, name: "Bombay", region: 6, lon: 73, lat: 19, value: "B", defense: "D" },
  { id: 87, name: "Hyderabad", region: 6, lon: 78.5, lat: 17, value: "B", defense: "D" },
  { id: 88, name: "Madras", region: 6, lon: 80, lat: 12, value: "A", defense: "C" },
  { id: 89, name: "Ceylon", region: 6, lon: 81, lat: 7.5, value: "B", defense: "D" },
  { id: 90, name: "Maratha States", region: 6, lon: 76, lat: 21, value: "B", defense: "C" },
  { id: 91, name: "Nepal", region: 6, lon: 84, lat: 28, value: "D", defense: "D" },
  { id: 92, name: "Bengal", region: 6, lon: 88, lat: 24, value: "B", defense: "D" },
  { id: 93, name: "Burma", region: 6, lon: 96, lat: 21, value: "D", defense: "D" },
  { id: 96, name: "Steppes", region: 6, lon: 66, lat: 46, value: "B", defense: "D" },
  { id: 131, name: "Socotra Is.", region: 6, lon: 54, lat: 12.5, value: "D", defense: "C" },

  // Region 7 — The Far East
  { id: 97, name: "Siberia", region: 7, lon: 100, lat: 62, value: "B", defense: "C", terrain: 3 },
  { id: 98, name: "Outer Mongolia", region: 7, lon: 103, lat: 47, value: "C", defense: "D" },
  { id: 99, name: "Manchuria", region: 7, lon: 125, lat: 46, value: "B", defense: "B" },
  { id: 100, name: "Sinkiang", region: 7, lon: 84, lat: 41, value: "C", defense: "D" },
  { id: 101, name: "Szechwan", region: 7, lon: 104, lat: 30, value: "C", defense: "D" },
  { id: 102, name: "Yunnan", region: 7, lon: 101, lat: 25, value: "B", defense: "B" },
  { id: 103, name: "Fukien", region: 7, lon: 118, lat: 26, value: "B", defense: "B" },
  { id: 104, name: "Shansi", region: 7, lon: 113, lat: 37, value: "B", defense: "A" },
  { id: 105, name: "Korea", region: 7, lon: 127.5, lat: 37, value: "B", defense: "B" },
  { id: 106, name: "Indochina", region: 7, lon: 106, lat: 16, value: "A", defense: "B" },
  { id: 107, name: "Siam", region: 7, lon: 101, lat: 15, value: "B", defense: "D" },
  { id: 108, name: "Cambodia", region: 7, lon: 105, lat: 12, value: "B", defense: "D", terrain: 1 },
  { id: 109, name: "Luzon", region: 7, lon: 121, lat: 16, value: "B", defense: "C", terrain: 3 },
  { id: 110, name: "Mindanao", region: 7, lon: 125, lat: 8, value: "C", defense: "D", terrain: 3 },
  { id: 111, name: "Midway", region: 7, lon: 178, lat: 28, value: "C", defense: "D" },
  { id: 112, name: "Mariana", region: 7, lon: 146, lat: 16, value: "C", defense: "D" },
  { id: 113, name: "Formosa", region: 7, lon: 121, lat: 23.5, value: "C", defense: "C" },
  { id: 114, name: "Honshu", region: 7, lon: 138, lat: 36, value: "A", defense: "A" },
  { id: 115, name: "Hokkaido", region: 7, lon: 143, lat: 43, value: "A", defense: "D" },
  { id: 116, name: "Kyushu", region: 7, lon: 131, lat: 32, value: "A", defense: "D" },

  // Region 8 — The South Pacific
  { id: 117, name: "Malaya", region: 8, lon: 101, lat: 4, value: "A", defense: "D", terrain: 3 },
  { id: 118, name: "Sumatra", region: 8, lon: 101, lat: 0, value: "B", defense: "D" },
  { id: 119, name: "Borneo", region: 8, lon: 114, lat: 0.5, value: "B", defense: "D" },
  { id: 120, name: "Java", region: 8, lon: 110, lat: -7, value: "B", defense: "D" },
  { id: 121, name: "Timor", region: 8, lon: 125, lat: -9, value: "B", defense: "D" },
  { id: 122, name: "Celebes", region: 8, lon: 121, lat: -2, value: "D", defense: "D", terrain: 2 },
  { id: 123, name: "Moluccas", region: 8, lon: 128, lat: -1, value: "D", defense: "D", terrain: 3 },
  { id: 124, name: "Ceram", region: 8, lon: 129, lat: -3, value: "D", defense: "D" },
  { id: 125, name: "New Guinea", region: 8, lon: 141, lat: -5, value: "C", defense: "D" },
  { id: 126, name: "N. Australia", region: 8, lon: 133, lat: -16, value: "D", defense: "D" },
  { id: 127, name: "W. Australia", region: 8, lon: 120, lat: -25, value: "C", defense: "D" },
  { id: 128, name: "Queensland", region: 8, lon: 146, lat: -22, value: "C", defense: "D" },
  { id: 129, name: "New South Wales", region: 8, lon: 149, lat: -33, value: "C", defense: "D", terrain: 1 },
  { id: 130, name: "Caroline Is.", region: 8, lon: 150, lat: 7, value: "C", defense: "D" },
];

/**
 * Extra seeds bound to an existing area. A country is the union of all its
 * seeds' mesh cells, so long or sprawling territories (Norway's coast, Chile,
 * Siberia) need several seeds spread along their real extent, otherwise their
 * far ends get claimed by a nearer neighbour's single seed.
 */
const EXTRA_SEEDS: readonly { readonly id: number; readonly lon: number; readonly lat: number }[] = [
  // Norway — long Atlantic coast up to the North Cape.
  { id: 34, lon: 12, lat: 65 },
  { id: 34, lon: 17, lat: 68 },
  { id: 34, lon: 24, lat: 70 },
  // Sweden — stretches north-south.
  { id: 35, lon: 17, lat: 66 },
  { id: 35, lon: 14, lat: 58 },
  // Chile — a ribbon down the Pacific coast.
  { id: 30, lon: -70, lat: -24 },
  { id: 30, lon: -72, lat: -45 },
  { id: 30, lon: -74, lat: -52 },
  // Argentina — reaches into Patagonia.
  { id: 31, lon: -68, lat: -46 },
  { id: 31, lon: -66, lat: -41 },
  // Brazil — vast interior.
  { id: 27, lon: -60, lat: -5 },
  { id: 27, lon: -52, lat: -12 },
  { id: 27, lon: -45, lat: -18 },
  // Siberia — spans most of northern Asia.
  { id: 97, lon: 88, lat: 66 },
  { id: 97, lon: 120, lat: 66 },
  { id: 97, lon: 140, lat: 64 },
  { id: 97, lon: 160, lat: 66 },
  { id: 97, lon: 110, lat: 56 },
  // Kazakh steppes.
  { id: 96, lon: 60, lat: 49 },
  { id: 96, lon: 76, lat: 48 },
  // Italy — reach up the peninsula into the Po valley so it (not Marseilles)
  // claims the north-west.
  { id: 40, lon: 9, lat: 45.5 },
  { id: 40, lon: 12, lat: 45.5 },
  // Austria-Hungary — extend west over the Alps/Switzerland so France's
  // Marseilles stops bulging eastward.
  { id: 41, lon: 10, lat: 47 },
  { id: 41, lon: 13, lat: 47 },
  // Egypt/Libya/Sudan desert spread.
  { id: 60, lon: 20, lat: 24 },
  // Western Australia interior.
  { id: 127, lon: 122, lat: -28 },
];

/**
 * Cross-region land bridges and hand-picked special crossings over inland
 * waters. Geometry supplies the rest; these guarantee historically important
 * connections the coarse coastline might otherwise miss.
 */
const FORCED_LAND_LINKS: readonly (readonly [number, number])[] = [
  [14, 21], // Costa Rica - Columbia (Panama)
  [39, 56], // Spain - Morocco (Gibraltar)
  [40, 59], // Italy - Tunisia
  [42, 79], // Balkans - Ottoman (manual special crossing)
  [43, 79], // Romania - Ottoman
  [95, 96], // Moscow - Steppes
  [94, 96], // Ukraine - Steppes
  [61, 81], // Egypt - Arabia (Sinai)
  [61, 79], // Egypt - Ottoman (Suez)
  [69, 72], // Congo - Angola
  [68, 76], // East Africa - Mozambique
  [93, 102], // Burma - Yunnan
  [93, 107], // Burma - Siam
  [82, 100], // Afghanistan - Sinkiang
  [106, 117], // Indochina - Malaya
  [107, 117], // Siam - Malaya
  [114, 116], // Honshu - Kyushu (manual special crossing)
  [82, 84], // Afghanistan - Punjab (manual special crossing)
];

export function buildEarth(): WorldDefinition {
  const sites: WorldSite[] = SITE_SPECS.map((s) => ({
    id: areaId(s.id),
    name: s.name,
    region: regionId(s.region),
    point: projectEquirectangular(s.lon, s.lat),
    terrain: s.terrain ?? 0,
    value: s.value,
    defense: s.defense,
  }));

  const forcedLinks: (readonly [AreaId, AreaId])[] = FORCED_LAND_LINKS.map(
    ([a, b]) => [areaId(a), areaId(b)] as const,
  );

  const extraSeeds = EXTRA_SEEDS.map((e) => ({
    area: areaId(e.id),
    point: projectEquirectangular(e.lon, e.lat),
  }));

  return buildWorldFromSites({
    id: "earth",
    sites,
    regions: REAL_REGIONS,
    landMask: LAND_MASK,
    atomSpacing: 1.1,
    atomJitter: 0.42,
    seed: 1337,
    extraSeeds,
    minLandArea: 2,
    islandGlyphRadius: 1.0,
    forcedLinks,
    boundsPadding: 4,
  });
}
