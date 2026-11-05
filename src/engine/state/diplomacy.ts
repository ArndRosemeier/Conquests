import type { RuleSet } from "../ruleset/types.ts";
import { IllegalActionError } from "../types.ts";
import type { PowerId } from "../types.ts";
import type { GameEvent } from "./events.ts";
import type { GameState, PeaceOffer } from "./gameState.ts";
import { declareWar, endWar, getPowerState, isAtWar, withPower } from "./helpers.ts";
import { nowSeason } from "./knowledge.ts";

/**
 * War, peace and reputation. War is never a side effect of marching: a power
 * must declare it (costing reputation), and it ends only by a peace treaty,
 * which is followed by a truce during which war cannot be declared again.
 */

/** Order-independent key for a pair of powers. */
export function pairKey(a: PowerId, b: PowerId): string {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

const gainKey = (a: PowerId, b: PowerId): string => `${String(a)}>${String(b)}`;

export function reputationOf(state: GameState, ruleSet: RuleSet, power: PowerId): number {
  return state.reputation?.[String(power)] ?? ruleSet.diplomacy.reputationStart;
}

/** The first absolute season war may be declared again, or null without a truce. */
export function truceUntil(state: GameState, a: PowerId, b: PowerId): number | null {
  const until = state.truces?.[pairKey(a, b)];
  return until !== undefined && until > nowSeason(state) ? until : null;
}

/** Seasons the current war between a and b has lasted (0 when not at war). */
export function warLength(state: GameState, a: PowerId, b: PowerId): number {
  if (!isAtWar(state, a, b)) return 0;
  const since = state.warSince?.[pairKey(a, b)];
  return since === undefined ? 0 : Math.max(0, nowSeason(state) - since);
}

/** How the current war is going for `a`: positive when winning. */
export function warBalance(state: GameState, a: PowerId, b: PowerId): number {
  const g = state.warGains ?? {};
  return (g[gainKey(a, b)] ?? 0) - (g[gainKey(b, a)] ?? 0);
}

/**
 * Whether `attacker` may attack land held by `owner`: neutral countries and
 * neutral-controlled powers always; another great power only while at war.
 */
export function canAttackOwner(state: GameState, attacker: PowerId, owner: PowerId | null): boolean {
  if (owner === null || owner === attacker) return true;
  if (getPowerState(state, owner).control === "neutral") return true;
  return isAtWar(state, attacker, owner);
}

/** Why `by` cannot declare war on `target` right now, or null if it can. */
export function warBlocker(state: GameState, by: PowerId, target: PowerId): string | null {
  if (by === target) return "You cannot declare war on yourself";
  const t = getPowerState(state, target);
  if (t.eliminated) return `${String(target)} is out of the game`;
  if (t.control === "neutral") return `${String(target)} is not in the game; its land can be taken without war`;
  if (isAtWar(state, by, target)) return `Already at war with ${String(target)}`;
  if (truceUntil(state, by, target) !== null) return `A truce with ${String(target)} is still in force`;
  return null;
}

/** Reputation `by` would lose for declaring war on `target`. */
export function declareWarCost(state: GameState, ruleSet: RuleSet, target: PowerId): number {
  const d = ruleSet.diplomacy;
  return reputationOf(state, ruleSet, target) < d.pariahBelow ? d.declareWarOnPariahCost : d.declareWarCost;
}

function adjustReputation(state: GameState, ruleSet: RuleSet, power: PowerId, delta: number): GameState {
  const now = reputationOf(state, ruleSet, power);
  const next = Math.max(0, Math.min(ruleSet.diplomacy.reputationMax, now + delta));
  return { ...state, reputation: { ...(state.reputation ?? {}), [String(power)]: next } };
}

function dropOffersBetween(offers: readonly PeaceOffer[], a: PowerId, b: PowerId): readonly PeaceOffer[] {
  return offers.filter((o) => !((o.from === a && o.to === b) || (o.from === b && o.to === a)));
}

/** Put two powers at war (used by declarations and by scenarios that start at war). */
export function startWar(state: GameState, a: PowerId, b: PowerId): GameState {
  const key = pairKey(a, b);
  const gains = { ...(state.warGains ?? {}) };
  delete gains[gainKey(a, b)];
  delete gains[gainKey(b, a)];
  return {
    ...state,
    war: declareWar(state.war, a, b),
    warSince: { ...(state.warSince ?? {}), [key]: nowSeason(state) },
    warGains: gains,
    peaceOffers: dropOffersBetween(state.peaceOffers ?? [], a, b),
  };
}

export function declareWarAction(
  state: GameState,
  ruleSet: RuleSet,
  by: PowerId,
  target: PowerId,
): { state: GameState; events: GameEvent[] } {
  const blocker = warBlocker(state, by, target);
  if (blocker !== null) throw new IllegalActionError(blocker);
  const cost = declareWarCost(state, ruleSet, target);
  let next = startWar(state, by, target);
  next = adjustReputation(next, ruleSet, by, -cost);
  next = { ...next, tick: next.tick + 1 };
  return { state: next, events: [{ type: "WAR_DECLARED", by, against: target, reputationLoss: cost }] };
}

export function offerPeaceAction(
  state: GameState,
  by: PowerId,
  target: PowerId,
  payment: number,
): { state: GameState; events: GameEvent[] } {
  if (!isAtWar(state, by, target)) throw new IllegalActionError(`Not at war with ${String(target)}`);
  if (!Number.isFinite(payment) || Math.round(payment) !== payment) {
    throw new IllegalActionError(`Payment must be a whole number of dollars (got ${payment})`);
  }
  if (payment > getPowerState(state, by).treasury) {
    throw new IllegalActionError("You cannot offer more than you have in the treasury");
  }
  const offers = (state.peaceOffers ?? []).filter((o) => !(o.from === by && o.to === target));
  const next = { ...state, peaceOffers: [...offers, { from: by, to: target, payment }], tick: state.tick + 1 };
  return { state: next, events: [{ type: "PEACE_OFFERED", by, to: target, payment }] };
}

export function answerPeaceAction(
  state: GameState,
  ruleSet: RuleSet,
  me: PowerId,
  from: PowerId,
  accept: boolean,
): { state: GameState; events: GameEvent[] } {
  const offer = (state.peaceOffers ?? []).find((o) => o.from === from && o.to === me);
  if (offer === undefined) throw new IllegalActionError(`There is no peace offer from ${String(from)}`);
  const rest = (state.peaceOffers ?? []).filter((o) => o !== offer);
  if (!accept) {
    return {
      state: { ...state, peaceOffers: rest, tick: state.tick + 1 },
      events: [{ type: "PEACE_DECLINED", by: me, offerer: from }],
    };
  }
  let next: GameState = state;
  if (offer.payment !== 0) {
    const payer = offer.payment > 0 ? from : me;
    const payee = offer.payment > 0 ? me : from;
    const amount = Math.abs(offer.payment);
    const p = getPowerState(next, payer);
    if (p.treasury < amount) {
      throw new IllegalActionError(`${String(payer)} can no longer pay ${amount}`);
    }
    next = withPower(next, { ...p, treasury: p.treasury - amount });
    const q = getPowerState(next, payee);
    next = withPower(next, { ...q, treasury: q.treasury + amount });
  }
  next = makePeace(next, ruleSet, from, me);
  return { state: next, events: [{ type: "WAR_ENDED", by: from, against: me, payment: offer.payment }] };
}

/** End a war: clear its bookkeeping and start the truce. */
export function makePeace(state: GameState, ruleSet: RuleSet, a: PowerId, b: PowerId): GameState {
  const key = pairKey(a, b);
  const since = { ...(state.warSince ?? {}) };
  delete since[key];
  const gains = { ...(state.warGains ?? {}) };
  delete gains[gainKey(a, b)];
  delete gains[gainKey(b, a)];
  return {
    ...state,
    war: endWar(state.war, a, b),
    warSince: since,
    warGains: gains,
    truces: { ...(state.truces ?? {}), [key]: nowSeason(state) + ruleSet.diplomacy.truceSeasons },
    peaceOffers: dropOffersBetween(state.peaceOffers ?? [], a, b),
    tick: state.tick + 1,
  };
}

/** Book war-balance points for `winner` against `loser` (battles and land taken). */
export function addWarGains(state: GameState, winner: PowerId, loser: PowerId, points: number): GameState {
  if (!isAtWar(state, winner, loser) || points === 0) return state;
  const key = gainKey(winner, loser);
  const g = state.warGains ?? {};
  return { ...state, warGains: { ...g, [key]: (g[key] ?? 0) + points } };
}

/** A power's open offers lapse when its next turn begins. */
export function expireOffersFrom(state: GameState, power: PowerId): GameState {
  const offers = state.peaceOffers ?? [];
  if (!offers.some((o) => o.from === power)) return state;
  return { ...state, peaceOffers: offers.filter((o) => o.from !== power) };
}

/** Yearly reputation recovery, up to the starting value. */
export function recoverReputation(state: GameState, ruleSet: RuleSet): GameState {
  const d = ruleSet.diplomacy;
  const rep: Record<string, number> = { ...(state.reputation ?? {}) };
  for (const p of Object.values(state.powers)) {
    const now = rep[String(p.id)] ?? d.reputationStart;
    if (now < d.reputationStart) rep[String(p.id)] = Math.min(d.reputationStart, now + d.recoveryPerYear);
  }
  return { ...state, reputation: rep };
}

/** Peace offers waiting for `power` to answer. */
export function offersTo(state: GameState, power: PowerId): readonly PeaceOffer[] {
  return (state.peaceOffers ?? []).filter((o) => o.to === power);
}
