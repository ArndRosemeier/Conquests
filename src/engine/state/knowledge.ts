import { SEASONS } from "../types.ts";
import type { AreaId, PowerId, Season } from "../types.ts";
import type { GameState, IntelReport } from "./gameState.ts";
import { getAreaState } from "./helpers.ts";

/**
 * Player knowledge lives separately from the ground truth. Areas are observed by
 * spying, which stores a frozen snapshot (see IntelReport). This module answers
 * "what does power P currently believe about area A?" without ever leaking the
 * live troop count of foreign areas. Both the UI and the AI read through here so
 * they play by the same fog-of-war rules.
 */

/** Absolute season counter (monotonic across years) for age arithmetic. */
export function absSeason(year: number, season: Season): number {
  return year * SEASONS.length + SEASONS.indexOf(season);
}

/** The current time as an absolute season index. */
export function nowSeason(state: GameState): number {
  return absSeason(state.year, state.season);
}

/** The latest espionage snapshot a power holds for an area, if any. */
export function getIntel(
  state: GameState,
  power: PowerId,
  area: AreaId,
): IntelReport | null {
  return state.intel[String(power)]?.[String(area)] ?? null;
}

/**
 * What a power perceives about an area:
 * - `own`: it controls the area, so the figures are exact and live.
 * - `report`: a stale espionage snapshot, with its age in seasons.
 * - `unknown`: never scouted (and not owned).
 */
export type Perception =
  | {
      readonly kind: "own";
      readonly troops: number;
      readonly fleets: number;
      readonly owner: PowerId | null;
      readonly fortified: boolean;
    }
  | {
      readonly kind: "report";
      readonly troops: number;
      readonly fleets: number;
      readonly owner: PowerId | null;
      readonly fortified: boolean;
      readonly ageSeasons: number;
      readonly observedYear: number;
      readonly observedSeason: Season;
    }
  | { readonly kind: "unknown" };

export function perceive(state: GameState, power: PowerId, area: AreaId): Perception {
  const a = getAreaState(state, area);
  if (a.owner === power) {
    return { kind: "own", troops: a.troops, fleets: a.fleets, owner: a.owner, fortified: a.fortified };
  }
  const report = getIntel(state, power, area);
  if (report === null) return { kind: "unknown" };
  return {
    kind: "report",
    troops: report.troops,
    fleets: report.fleets,
    owner: report.owner,
    fortified: report.fortified,
    ageSeasons: nowSeason(state) - absSeason(report.observedYear, report.observedSeason),
    observedYear: report.observedYear,
    observedSeason: report.observedSeason,
  };
}

/**
 * Stores a fresh espionage snapshot of an area for a power, overwriting any
 * earlier (now stale) report. Spying is the only way to learn a foreign garrison.
 */
export function recordIntel(state: GameState, power: PowerId, area: AreaId): GameState {
  const key = String(power);
  const a = getAreaState(state, area);
  const report: IntelReport = {
    troops: a.troops,
    fleets: a.fleets,
    owner: a.owner,
    fortified: a.fortified,
    observedYear: state.year,
    observedSeason: state.season,
  };
  const prev = state.intel[key] ?? {};
  return {
    ...state,
    intel: { ...state.intel, [key]: { ...prev, [String(area)]: report } },
  };
}

/**
 * Drops a power's report on an area. Used when an attack there is thrown back:
 * the old count was clearly wrong, but the attacker learns nothing new and must
 * spy again to find out the real garrison.
 */
export function forgetIntel(state: GameState, power: PowerId, area: AreaId): GameState {
  const key = String(power);
  const prev = state.intel[key];
  if (prev === undefined || prev[String(area)] === undefined) return state;
  const { [String(area)]: _dropped, ...rest } = prev;
  return { ...state, intel: { ...state.intel, [key]: rest } };
}
