# Colonial Conquest (Web Remake)

A modern, single-player TypeScript/React remake of SSI's *Colonial Conquest* (1985) — grand strategy of imperial expansion, 1880–1914. You play one of six great powers (England, Germany, France, USA, Japan, Russia) competing to control 130+ minor countries through building, diplomacy, espionage, subversion, and war. First to the winning score wins.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build
npm run test       # run the engine/game test suite (Vitest)
npm run typecheck  # strict type-check only
npm run gen:world  # regenerate the precomputed real-world map asset
```

## How to play

1. On the setup screen pick a scenario (Standard / 1880 / 1914), the power you control, AI difficulty, and a winning score.
2. Each spring you get Build phases: Army Build, Fleet Build, Fortify, Economic Aid, Espionage, Subversion. Every turn you get Army and Fleet movement, then combat resolves.
3. Use the left panel for the current phase; click areas on the map to select build sites, spy/subvert targets, or movement source/destination. Hover any area for details.
4. Advance with "Next Phase" / "End Turn" in the top bar. AI powers and combat resolve automatically.

## Architecture

The design keeps the rules engine pure and everything else pluggable, so players, constants, and maps are all swappable and future-proof.

- `src/engine/` — pure, framework-free rules engine (no React). Runs headless (used by tests and AI).
  - `ruleset/` — all balance constants in one `RuleSet` object (`classic.ts`). Swap it to retune or add powers.
  - `world/` — `WorldDefinition` (areas, regions, adjacency, geometry); `scenarios.ts` for starting positions. It is produced by a generic seed-based mesh pipeline (`world/geo/worldBuilder.ts`): give it labeled seed points + a land mask and it scatters a fine Voronoi "atom" mesh, assigns each atom to its nearest country seed, and unions each country's atoms (then clips to the coast) to derive territory shapes, land adjacency (atoms of different countries that share a mesh edge), and ports (land atoms touching ocean). Because a country is a union of many small cells, borders are naturally organic and non-convex, elongated countries hold together (via a few extra seeds), and offshore islands never annex a far shore. `world/earthSource.ts` is the first caller (real lon/lat + a real 50m coastline). Because building it is slow (~15s), the real world is precomputed offline by `scripts/generateEarth.ts` (`npm run gen:world`) into `world/data/earth.generated.json`, which `world/realWorld.ts` loads instantly; the same pipeline can build procedural worlds at runtime.
  - `state/` — serializable `GameState`, discriminated-union `Action`s, seeded RNG, reducer, phase state machine, combat, scoring, save/load.
- `src/controllers/` — `PlayerController` interface with interchangeable `HumanController` and `AIController`. A power's controller can be swapped at runtime (human ⇄ AI).
- `src/game/gameRunner.ts` — orchestrates phases and play order, asks controllers for actions, applies them through the reducer, and resolves combat.
- `src/ui/` — React + SVG. `MapView` renders any `WorldDefinition`; phase panels drive human input.

Key properties: deterministic (seeded RNG → testable, replayable, save/load-ready), actions are serializable data, and illegal actions throw loudly rather than being silently ignored.

## Notes on fidelity

Rules, unit factors, costs, phases, and the area table follow the original manual. Some values that were unavailable (the historical Scenario Data Card, exact combat formulas) are reasonable, clearly data-driven approximations that can be tuned in `ruleset/classic.ts` and `world/scenarios.ts`. The map is generated from real Earth geography: each of the 131 areas has a real longitude/latitude, and territory shapes come from a fine Voronoi "atom" mesh whose cells are assigned to the nearest country seed and unioned per country, then clipped to a real 50m coastline (Natural Earth via `world-atlas`); ports/adjacency are derived from that geometry. Because each country is a union of many small cells, inland borders are naturally organic and non-convex (no artificial roughening needed) while real coastlines stay crisp, and a handful of extra seeds keep long countries (Norway, Chile, Siberia) intact. Because the same builder is fed by plain data, a procedurally generated world (synthetic points + synthetic landmass) drops in without touching the engine or UI.
