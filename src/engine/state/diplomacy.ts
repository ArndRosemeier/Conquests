import type { RuleSet } from "../ruleset/types.ts";
import { IllegalActionError } from "../types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea, neighborsOf } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { GameEvent } from "./events.ts";
import type { CallToArms, Coalition, GameState, PeaceOffer, Proposal, Treaty } from "./gameState.ts";
import { declareWar, endWar, getAreaState, getPowerState, isAtWar, withArea, withPower } from "./helpers.ts";
import { nowSeason } from "./knowledge.ts";
import { changeControl } from "./scoring.ts";

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

/** Reputation `by` would lose for declaring war on `target` (more when it breaks a treaty). */
export function declareWarCost(state: GameState, ruleSet: RuleSet, by: PowerId, target: PowerId): number {
  const d = ruleSet.diplomacy;
  const base = reputationOf(state, ruleSet, target) < d.pariahBelow ? d.declareWarOnPariahCost : d.declareWarCost;
  const treaty = treatyBetween(state, by, target);
  return base + (treaty?.kind === "pact" ? d.pactBreakCost : treaty?.kind === "alliance" ? d.allyBetrayalCost : 0);
}

// --- Treaties ---------------------------------------------------------------

export function treatyBetween(state: GameState, a: PowerId, b: PowerId): Treaty | undefined {
  return (state.treaties ?? []).find((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
}

export function alliesOf(state: GameState, power: PowerId): PowerId[] {
  return (state.treaties ?? [])
    .filter((t) => t.kind === "alliance" && (t.a === power || t.b === power))
    .map((t) => (t.a === power ? t.b : t.a));
}

function withoutTreaty(state: GameState, a: PowerId, b: PowerId): GameState {
  const t = treatyBetween(state, a, b);
  return t === undefined ? state : { ...state, treaties: (state.treaties ?? []).filter((x) => x !== t) };
}

function addGoodwill(state: GameState, from: PowerId, to: PowerId, points: number): GameState {
  const key = gainKey(from, to);
  const g = state.goodwill ?? {};
  const next = Math.max(-60, Math.min(60, (g[key] ?? 0) + points));
  return { ...state, goodwill: { ...g, [key]: next } };
}

/** Goodwill `from` has earned with `to` through gifts and kept promises. */
export function goodwillOf(state: GameState, from: PowerId, to: PowerId): number {
  return state.goodwill?.[gainKey(from, to)] ?? 0;
}

/** A gift earns goodwill: 1 point per $100k, capped. */
export function recordGift(state: GameState, from: PowerId, to: PowerId, amount: number): GameState {
  return addGoodwill(state, from, to, Math.min(20, amount / 100_000));
}

/**
 * Put `joiner` at war with `enemy` and raise calls to arms for the victim's
 * allies. Used by declarations, by allies answering a call, and by war aid.
 * Any treaty between the two ends; a truce does not stop an ally or a helper.
 */
function joinWar(
  state: GameState,
  ruleSet: RuleSet,
  joiner: PowerId,
  enemy: PowerId,
  cost: number,
  reason: "declared" | "ally" | "aid",
  events: GameEvent[],
): GameState {
  let next = state;
  const broken = treatyBetween(next, joiner, enemy);
  if (broken !== undefined) {
    next = withoutTreaty(next, joiner, enemy);
    events.push({ type: "TREATY_ENDED", kind: broken.kind, a: joiner, b: enemy, reason: "broken" });
  }
  next = startWar(next, joiner, enemy);
  const truces = { ...(next.truces ?? {}) };
  delete truces[pairKey(joiner, enemy)];
  next = { ...next, truces };
  if (cost !== 0) next = adjustReputation(next, ruleSet, joiner, -cost);
  events.push({ type: "WAR_DECLARED", by: joiner, against: enemy, reputationLoss: cost, reason });

  // The victim's allies are called to arms.
  const expires = nowSeason(next) + ruleSet.diplomacy.offerSeasons;
  const calls = [...(next.callsToArms ?? [])];
  for (const ally of alliesOf(next, enemy)) {
    if (ally === joiner || getPowerState(next, ally).eliminated || isAtWar(next, ally, joiner)) continue;
    if (calls.some((c) => c.ally === ally && c.enemy === joiner)) continue;
    calls.push({ ally, partner: enemy, enemy: joiner, expires });
    events.push({ type: "CALL_TO_ARMS", ally, partner: enemy, enemy: joiner });
  }
  return { ...next, callsToArms: calls };
}

/** Calls to arms waiting for `power` to answer. */
export function callsTo(state: GameState, power: PowerId): readonly CallToArms[] {
  return (state.callsToArms ?? []).filter((c) => c.ally === power);
}

export function answerCallAction(
  state: GameState,
  ruleSet: RuleSet,
  me: PowerId,
  partner: PowerId,
  join: boolean,
): { state: GameState; events: GameEvent[] } {
  const call = (state.callsToArms ?? []).find((c) => c.ally === me && c.partner === partner);
  if (call === undefined) throw new IllegalActionError(`${String(partner)} has not called you to arms`);
  let next: GameState = { ...state, callsToArms: (state.callsToArms ?? []).filter((c) => c !== call), tick: state.tick + 1 };
  const events: GameEvent[] = [];
  const d = ruleSet.diplomacy;
  if (join) {
    if (!isAtWar(next, me, call.enemy)) next = joinWar(next, ruleSet, me, call.enemy, 0, "ally", events);
    next = adjustReputation(next, ruleSet, me, d.answerCallGain);
    next = addGoodwill(next, me, partner, 20);
  } else {
    next = adjustReputation(next, ruleSet, me, -d.refuseCallCost);
    next = addGoodwill(next, me, partner, -40);
    next = withoutTreaty(next, me, partner);
    events.push({ type: "TREATY_ENDED", kind: "alliance", a: me, b: partner, reason: "refused" });
  }
  events.unshift({ type: "CALL_ANSWERED", ally: me, partner, enemy: call.enemy, joined: join });
  return { state: next, events };
}

/** Why `from` cannot propose this to `to`, or null. */
export function proposalBlocker(
  state: GameState,
  ruleSet: RuleSet,
  from: PowerId,
  to: PowerId,
  kind: Proposal["kind"],
  enemy: PowerId | null,
  years: number,
): string | null {
  if (from === to) return "Not with yourself";
  const t = getPowerState(state, to);
  if (t.eliminated || t.control === "neutral") return `${String(to)} is not in the game`;
  const treaty = treatyBetween(state, from, to);
  if (kind === "pact" || kind === "alliance") {
    if (isAtWar(state, from, to)) return "Make peace first";
    if (kind === "pact" && treaty !== undefined) return treaty.kind === "pact" ? "A pact is already in force" : "You are already allies";
    if (kind === "alliance" && treaty?.kind === "alliance") return "You are already allies";
    if (kind === "pact" && !ruleSet.diplomacy.pactYears.includes(years)) return `A pact runs ${ruleSet.diplomacy.pactYears.join(" or ")} years`;
    return null;
  }
  if (enemy === null || enemy === from || enemy === to) return "Name the enemy";
  const fromAtWar = isAtWar(state, from, enemy);
  const toAtWar = isAtWar(state, to, enemy);
  if (fromAtWar === toAtWar) return fromAtWar ? "Both of you already fight them" : "Neither of you is at war with them";
  if (isAtWar(state, from, to)) return "You are at war with each other";
  const helper = fromAtWar ? to : from;
  if (truceUntil(state, helper, enemy) !== null) return `${String(helper)} has a truce with ${String(enemy)}`;
  return null;
}

export function proposeAction(
  state: GameState,
  ruleSet: RuleSet,
  from: PowerId,
  p: { readonly to: PowerId; readonly kind: Proposal["kind"]; readonly payment: number; readonly years: number; readonly enemy: PowerId | null },
): { state: GameState; events: GameEvent[] } {
  const blocker = proposalBlocker(state, ruleSet, from, p.to, p.kind, p.enemy, p.years);
  if (blocker !== null) throw new IllegalActionError(blocker);
  if (!Number.isFinite(p.payment) || Math.round(p.payment) !== p.payment) throw new IllegalActionError("Payment must be whole dollars");
  if (p.payment > getPowerState(state, from).treasury) throw new IllegalActionError("You cannot offer more than you have");
  const proposal: Proposal = {
    kind: p.kind,
    from,
    to: p.to,
    payment: p.payment,
    years: p.kind === "pact" ? p.years : 0,
    enemy: p.kind === "aid" ? p.enemy : null,
    expires: nowSeason(state) + ruleSet.diplomacy.offerSeasons,
  };
  const rest = (state.proposals ?? []).filter((x) => !(x.from === from && x.to === p.to && x.kind === p.kind));
  return {
    state: { ...state, proposals: [...rest, proposal], tick: state.tick + 1 },
    events: [{ type: "PROPOSAL_MADE", from, to: p.to, kind: p.kind, payment: p.payment, enemy: proposal.enemy }],
  };
}

export function answerProposalAction(
  state: GameState,
  ruleSet: RuleSet,
  me: PowerId,
  from: PowerId,
  kind: Proposal["kind"],
  accept: boolean,
): { state: GameState; events: GameEvent[] } {
  const p = (state.proposals ?? []).find((x) => x.from === from && x.to === me && x.kind === kind);
  if (p === undefined) throw new IllegalActionError(`There is no such proposal from ${String(from)}`);
  let next: GameState = { ...state, proposals: (state.proposals ?? []).filter((x) => x !== p), tick: state.tick + 1 };
  if (!accept) return { state: next, events: [{ type: "PROPOSAL_DECLINED", by: me, from, kind }] };
  const blocker = proposalBlocker(next, ruleSet, from, me, kind, p.enemy, p.years);
  if (blocker !== null) throw new IllegalActionError(blocker);
  next = transfer(next, from, me, p.payment);
  const events: GameEvent[] = [];
  const now = nowSeason(next);
  if (kind === "pact" || kind === "alliance") {
    next = withoutTreaty(next, from, me);
    const treaty: Treaty = { kind, a: from, b: me, since: now, until: kind === "pact" ? now + p.years * 4 : null };
    next = { ...next, treaties: [...(next.treaties ?? []), treaty] };
    events.push({ type: "TREATY_SIGNED", kind, a: from, b: me, payment: p.payment, years: p.years });
  } else {
    const enemy = p.enemy!;
    const helper = isAtWar(next, from, enemy) ? me : from;
    const victim = helper === me ? from : me;
    events.push({ type: "AID_AGREED", helper, victim, enemy, payment: p.payment });
    // Coming to a treaty partner's aid costs no reputation; joining anyone else's war does.
    const cost = treatyBetween(next, helper, victim) !== undefined ? 0 : declareWarCost(next, ruleSet, helper, enemy);
    next = joinWar(next, ruleSet, helper, enemy, cost, "aid", events);
    next = addGoodwill(next, helper, victim, 10);
  }
  return { state: next, events };
}

export function leaveAllianceAction(
  state: GameState,
  ruleSet: RuleSet,
  me: PowerId,
  other: PowerId,
): { state: GameState; events: GameEvent[] } {
  if (treatyBetween(state, me, other)?.kind !== "alliance") throw new IllegalActionError(`You are not allied with ${String(other)}`);
  let next = withoutTreaty(state, me, other);
  next = adjustReputation(next, ruleSet, me, -ruleSet.diplomacy.leaveAllianceCost);
  next = { ...next, callsToArms: (next.callsToArms ?? []).filter((c) => !(c.ally === me && c.partner === other)), tick: next.tick + 1 };
  return { state: next, events: [{ type: "TREATY_ENDED", kind: "alliance", a: me, b: other, reason: "left" }] };
}

/** Move `payment` from `payer` to `payee` (negative: the other way). */
function transfer(state: GameState, payer: PowerId, payee: PowerId, payment: number): GameState {
  if (payment === 0) return state;
  const [src, dst] = payment > 0 ? [payer, payee] : [payee, payer];
  const amount = Math.abs(payment);
  const p = getPowerState(state, src);
  if (p.treasury < amount) throw new IllegalActionError(`${String(src)} can no longer pay ${amount}`);
  let next = withPower(state, { ...p, treasury: p.treasury - amount });
  const q = getPowerState(next, dst);
  next = withPower(next, { ...q, treasury: q.treasury + amount });
  return next;
}

/**
 * Season upkeep: pacts that ran their term end (both sides gain reputation),
 * stale proposals and calls lapse, and anything involving an eliminated power goes.
 */
export function tickDiplomacy(state: GameState, ruleSet: RuleSet): { state: GameState; events: GameEvent[] } {
  const now = nowSeason(state);
  const gone = (p: PowerId): boolean => state.powers[String(p)]?.eliminated ?? true;
  const events: GameEvent[] = [];
  let next = state;
  const keep: Treaty[] = [];
  for (const t of state.treaties ?? []) {
    if (gone(t.a) || gone(t.b)) continue;
    if (t.until !== null && t.until <= now) {
      events.push({ type: "TREATY_ENDED", kind: t.kind, a: t.a, b: t.b, reason: "expired" });
      next = adjustReputation(next, ruleSet, t.a, ruleSet.diplomacy.pactKeptGain);
      next = adjustReputation(next, ruleSet, t.b, ruleSet.diplomacy.pactKeptGain);
      continue;
    }
    keep.push(t);
  }
  return {
    state: {
      ...next,
      treaties: keep,
      proposals: (next.proposals ?? []).filter((p) => p.expires >= now && !gone(p.from) && !gone(p.to)),
      callsToArms: (next.callsToArms ?? []).filter((c) => c.expires >= now && !gone(c.ally) && !gone(c.partner) && !gone(c.enemy)),
      peaceOffers: (next.peaceOffers ?? []).filter((o) => !gone(o.from) && !gone(o.to)),
      coalitions: tickCoalitions(next, ruleSet, gone, events),
    },
    events,
  };
}

function tickCoalitions(state: GameState, ruleSet: RuleSet, gone: (p: PowerId) => boolean, events: GameEvent[]): Coalition[] {
  const out: Coalition[] = [];
  for (const c of state.coalitions ?? []) {
    if (gone(c.target)) {
      events.push({ type: "COALITION_ENDED", target: c.target, reason: "eliminated" });
      continue;
    }
    if (reputationOf(state, ruleSet, c.target) >= ruleSet.diplomacy.coalitionEndsAt) {
      events.push({ type: "COALITION_ENDED", target: c.target, reason: "recovered" });
      continue;
    }
    const members = c.members.filter((m) => !gone(m) && isAtWar(state, m, c.target));
    if (members.length === 0) {
      events.push({ type: "COALITION_ENDED", target: c.target, reason: "peace" });
      continue;
    }
    out.push({ ...c, members });
  }
  return out;
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
  const events: GameEvent[] = [];
  const next = joinWar(state, ruleSet, by, target, declareWarCost(state, ruleSet, by, target), "declared", events);
  return { state: { ...next, tick: next.tick + 1 }, events };
}

/** Whether `giver` may hand `area` over in a peace treaty: it must hold it, and home supply centers are never traded. */
export function cedeBlocker(state: GameState, giver: PowerId, area: AreaId): string | null {
  const a = state.areas[String(area)];
  if (a === undefined) return `Unknown area ${String(area)}`;
  if (a.owner !== giver) return `${String(giver)} does not hold area ${String(area)}`;
  if (a.supplyCenterOf === giver) return "Home supply centers cannot be handed over";
  return null;
}

/** Areas `giver` could hand over in a peace treaty. */
export function tradeableAreas(state: GameState, giver: PowerId): AreaId[] {
  return Object.values(state.areas)
    .filter((a) => cedeBlocker(state, giver, a.id) === null)
    .map((a) => a.id);
}

function checkAreas(state: GameState, ruleSet: RuleSet, giver: PowerId, areas: readonly AreaId[]): void {
  if (areas.length > ruleSet.diplomacy.maxCededAreas) {
    throw new IllegalActionError(`At most ${ruleSet.diplomacy.maxCededAreas} areas can change hands each way`);
  }
  if (new Set(areas.map(String)).size !== areas.length) throw new IllegalActionError("An area is listed twice");
  for (const area of areas) {
    const blocker = cedeBlocker(state, giver, area);
    if (blocker !== null) throw new IllegalActionError(blocker);
  }
}

export function offerPeaceAction(
  state: GameState,
  ruleSet: RuleSet,
  by: PowerId,
  target: PowerId,
  payment: number,
  cede: readonly AreaId[] = [],
  demand: readonly AreaId[] = [],
): { state: GameState; events: GameEvent[] } {
  if (!isAtWar(state, by, target)) throw new IllegalActionError(`Not at war with ${String(target)}`);
  if (!Number.isFinite(payment) || Math.round(payment) !== payment) {
    throw new IllegalActionError(`Payment must be a whole number of dollars (got ${payment})`);
  }
  if (payment > getPowerState(state, by).treasury) {
    throw new IllegalActionError("You cannot offer more than you have in the treasury");
  }
  checkAreas(state, ruleSet, by, cede);
  checkAreas(state, ruleSet, target, demand);
  const offers = (state.peaceOffers ?? []).filter((o) => !(o.from === by && o.to === target));
  const offer: PeaceOffer = { from: by, to: target, payment, cede: [...cede], demand: [...demand] };
  const next = { ...state, peaceOffers: [...offers, offer], tick: state.tick + 1 };
  return { state: next, events: [{ type: "PEACE_OFFERED", by, to: target, payment, cede: offer.cede!, demand: offer.demand! }] };
}

/**
 * Hand `area` from `giver` to `taker` under a treaty. The giver's troops and
 * fleets withdraw to a neighbouring area it still holds (or are disbanded);
 * the taker moves in with the minimum garrison.
 */
function cedeArea(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  area: AreaId,
  giver: PowerId,
  taker: PowerId,
  events: GameEvent[],
): GameState {
  const a = getAreaState(state, area);
  let next = state;
  const homes = neighborsOf(world, area)
    .map((id) => getAreaState(next, id))
    .filter((x) => x.owner === giver);
  const troopHome = homes[0];
  if (troopHome !== undefined && a.troops > 0) next = withArea(next, { ...troopHome, troops: troopHome.troops + a.troops });
  const port = homes.find((x) => getArea(world, x.id).isPort);
  if (port !== undefined && a.fleets > 0) {
    const p = getAreaState(next, port.id);
    next = withArea(next, { ...p, fleets: p.fleets + a.fleets });
  }
  next = withArea(next, { ...getAreaState(next, area), troops: ruleSet.limits.minGarrison, fleets: 0 });
  const changed = changeControl(next, area, taker, true);
  events.push(...changed.events);
  return changed.state;
}

export function answerPeaceAction(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
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
  const cede = offer.cede ?? [];
  const demand = offer.demand ?? [];
  checkAreas(state, ruleSet, from, cede);
  checkAreas(state, ruleSet, me, demand);
  let next = transfer(state, from, me, offer.payment);
  const events: GameEvent[] = [{ type: "WAR_ENDED", by: from, against: me, payment: offer.payment, ceded: [...cede], gained: [...demand] }];
  for (const area of cede) next = cedeArea(next, ruleSet, world, area, from, me, events);
  for (const area of demand) next = cedeArea(next, ruleSet, world, area, me, from, events);
  next = makePeace(next, ruleSet, from, me);
  next = leaveCoalitionsOnPeace(next, ruleSet, from, me, events);
  return { state: next, events };
}

// --- Coalitions -------------------------------------------------------------

export function coalitionAgainst(state: GameState, target: PowerId): Coalition | undefined {
  return (state.coalitions ?? []).find((c) => c.target === target);
}

/** Why `me` cannot join the coalition against `target`, or null. */
export function coalitionBlocker(state: GameState, ruleSet: RuleSet, me: PowerId, target: PowerId): string | null {
  if (me === target) return "Not against yourself";
  const t = getPowerState(state, target);
  if (t.eliminated || t.control === "neutral") return `${String(target)} is not in the game`;
  const c = coalitionAgainst(state, target);
  if (c?.members.includes(me)) return "You are already a member";
  if (c === undefined && reputationOf(state, ruleSet, target) >= ruleSet.diplomacy.pariahBelow) {
    return `A coalition needs ${String(target)}'s reputation below ${ruleSet.diplomacy.pariahBelow}`;
  }
  if (treatyBetween(state, me, target)?.kind === "alliance") return `You are allied with ${String(target)}`;
  if (!isAtWar(state, me, target)) return warBlocker(state, me, target);
  return null;
}

export function joinCoalitionAction(
  state: GameState,
  ruleSet: RuleSet,
  me: PowerId,
  target: PowerId,
): { state: GameState; events: GameEvent[] } {
  const blocker = coalitionBlocker(state, ruleSet, me, target);
  if (blocker !== null) throw new IllegalActionError(blocker);
  const events: GameEvent[] = [];
  let next = state;
  if (!isAtWar(next, me, target)) next = joinWar(next, ruleSet, me, target, declareWarCost(next, ruleSet, me, target), "declared", events);
  next = adjustReputation(next, ruleSet, me, ruleSet.diplomacy.coalitionJoinGain);
  const old = coalitionAgainst(next, target);
  const coalition: Coalition = old === undefined
    ? { target, members: [me], since: nowSeason(next) }
    : { ...old, members: [...old.members, me] };
  next = { ...next, coalitions: [...(next.coalitions ?? []).filter((c) => c !== old), coalition], tick: next.tick + 1 };
  events.unshift({ type: "COALITION_JOINED", power: me, target, founded: old === undefined, members: coalition.members.length });
  return { state: next, events };
}

/** After peace between a and b: a member that made peace with its coalition's target leaves it. */
function leaveCoalitionsOnPeace(state: GameState, ruleSet: RuleSet, a: PowerId, b: PowerId, events: GameEvent[]): GameState {
  let next = state;
  for (const [member, target] of [[a, b], [b, a]] as const) {
    const c = coalitionAgainst(next, target);
    if (c === undefined || !c.members.includes(member)) continue;
    const others = c.members.filter((m) => m !== member);
    const stillFighting = others.some((m) => isAtWar(next, m, target));
    const cost = stillFighting ? ruleSet.diplomacy.coalitionDesertCost : 0;
    if (cost > 0) next = adjustReputation(next, ruleSet, member, -cost);
    events.push({ type: "COALITION_LEFT", power: member, target, reputationLoss: cost });
    const rest = (next.coalitions ?? []).filter((x) => x !== c);
    if (stillFighting) {
      next = { ...next, coalitions: [...rest, { ...c, members: others }] };
    } else {
      next = { ...next, coalitions: rest };
      events.push({ type: "COALITION_ENDED", target, reason: "peace" });
    }
  }
  return next;
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
  // Goodwill fades by a fifth each year.
  const goodwill: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.goodwill ?? {})) {
    const faded = Math.round(v * 0.8 * 10) / 10;
    if (Math.abs(faded) >= 0.5) goodwill[k] = faded;
  }
  return { ...state, reputation: rep, goodwill };
}

/** Peace offers waiting for `power` to answer. */
export function offersTo(state: GameState, power: PowerId): readonly PeaceOffer[] {
  return (state.peaceOffers ?? []).filter((o) => o.to === power);
}
