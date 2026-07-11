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
  - `world/` — `WorldDefinition` (areas, regions, adjacency, geometry); `scenarios.ts` for starting positions. It is produced by a generic site-based Voronoi pipeline (`world/geo/worldBuilder.ts`): give it seed points + a land mask and it derives territory shapes, land adjacency, and ports. `world/realWorld.ts` is the first caller (real lon/lat + a real coastline); a procedural generator can be the next caller through the same pipeline.
  - `state/` — serializable `GameState`, discriminated-union `Action`s, seeded RNG, reducer, phase state machine, combat, scoring, save/load.
- `src/controllers/` — `PlayerController` interface with interchangeable `HumanController` and `AIController`. A power's controller can be swapped at runtime (human ⇄ AI).
- `src/game/gameRunner.ts` — orchestrates phases and play order, asks controllers for actions, applies them through the reducer, and resolves combat.
- `src/ui/` — React + SVG. `MapView` renders any `WorldDefinition`; phase panels drive human input.

Key properties: deterministic (seeded RNG → testable, replayable, save/load-ready), actions are serializable data, and illegal actions throw loudly rather than being silently ignored.

## Notes on fidelity

Rules, unit factors, costs, phases, and the area table follow the original manual. Some values that were unavailable (the historical Scenario Data Card, exact combat formulas) are reasonable, clearly data-driven approximations that can be tuned in `ruleset/classic.ts` and `world/scenarios.ts`. The map is generated from real Earth geography: each of the 131 areas has a real longitude/latitude, territory shapes are Voronoi cells clipped to a real coastline (Natural Earth via `world-atlas`), and ports/adjacency are derived from that geometry. Because the same builder is fed by plain data, a procedurally generated world (synthetic points + synthetic landmass) drops in without touching the engine or UI.
