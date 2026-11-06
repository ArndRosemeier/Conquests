import type { Action } from "../../engine/state/actions.ts";
import {
  callsTo,
  coalitionAgainst,
  coalitionBlocker,
  tradeableAreas,
  declareWarCost,
  treatyBetween,
  offersTo,
  reputationOf,
  truceUntil,
  warBalance,
  warBlocker,
  warLength,
} from "../../engine/state/diplomacy.ts";
import type { GameState, PeaceOffer, PersonaKnobs, Proposal } from "../../engine/state/gameState.ts";
import { enemiesOf, getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { opinionOf } from "../../engine/state/opinion.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { Rng } from "../../engine/state/rng.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import { getArea, neighborsOf } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { DecisionContext, PlayerController } from "../types.ts";
import { NEUTRAL_KNOB, knobs as neutralKnobs } from "./persona.ts";

/**
 * The diplomatic layer every AI shares. It wraps a military planner (v2 or v3)
 * and, before the planner runs, answers peace offers, offers peace in wars that
 * go badly, and rolls whether to declare new wars. Those rolls are what keep
 * wars unpredictable: odds rise with land hunger, a weak or distracted
 * neighbour, a runaway leader or a pariah, and fall with honor, reputation
 * worries and wars already being fought. A rolled war is only declared when the
 * planner, told it is at war, really finds an attack worth making.
 */

/** Tunables, in one place. Chances are per season and per neighbour. */
export const DIPLOMAT = {
  /** War chance at aggression 0 and 100, before modifiers. */
  baseWarChance: 0.01,
  aggressionWarChance: 0.035,
  maxWarChance: 0.3,
  /** Multiplier by how many neutral countries border the AI. */
  hungerNone: 2.6,
  hungerFew: 1.6,
  hungerSome: 1.0,
  hungerPlenty: 0.55,
  /** Chance multiplier per war already being fought. */
  perOpenWar: 0.3,
  leaderBonus: 1.5,
  pariahBonus: 1.6,
  firstYear: 0.25,
  /** Dollars per war-balance point when weighing payments. */
  dollarsPerPoint: 100_000,
  /** Desire to end a war per season it has lasted (in war-balance points). */
  wearinessPerSeason: 1.5,
  /** Desire to end a war per other war being fought. */
  otherWarPressure: 8,
  /** Balance at which a losing AI starts offering peace. */
  sueBelow: -15,
  /** War chance multipliers against treaty partners (times 1 − honor). */
  pactWarFactor: 0.3,
  allyWarFactor: 0.03,
  /** Join-call score needed to answer a call to arms. */
  joinCallAt: 30,
  /** Score needed to accept a pact; opinion needed to accept or propose an alliance. */
  pactAt: 5,
  allianceAt: 40,
  /** Opinion needed before proposing a pact, and the chance per season of doing so. */
  proposePactAt: 5,
  pactChance: 0.06,
  allianceChance: 0.15,
  /** Base price, in dollars, of joining someone else's war. */
  aidBasePrice: 3_000_000,
  askAidBelow: -10,
  askAidChance: 0.25,
  offerAidFriendAt: 20,
  offerAidChance: 0.1,
  /** Land in peace terms: points per area are its victory value + income / landIncomePerPoint + landBase. */
  landIncomePerPoint: 500_000,
  landBase: 5,
  /** Giving land up hurts more than gaining it pleases (home areas count double again). */
  landLossAversion: 1.5,
  /** Chance a winning AI demands land instead of money. */
  demandLandChance: 0.5,
  /** Coalitions: base chance per season to join, plus honor, plus per existing member; capped. */
  coalitionChance: 0.06,
  coalitionHonor: 0.2,
  coalitionPerMember: 0.08,
  coalitionMax: 0.45,
} as const;

/** What an area is worth in peace talks, in war-balance points. */
export function landWorth(state: GameState, area: AreaId): number {
  const a = state.areas[String(area)];
  if (a === undefined) return 0;
  return a.victoryValue + a.income / DIPLOMAT.landIncomePerPoint + DIPLOMAT.landBase;
}

/** Terms of a peace offer, as the AI builds them. */
interface PeaceTerms {
  readonly payment: number;
  readonly cede: readonly AreaId[];
  readonly demand: readonly AreaId[];
}

const unit = (v: number | undefined): number => Math.max(0, Math.min(1, (v ?? NEUTRAL_KNOB) / 100));

function seedFor(state: GameState, power: PowerId): number {
  let h = state.rngState ^ Math.imul(state.tick + 1, 0x9e3779b1);
  for (const ch of String(power)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * What computer power `me` charges to join `victim`'s war against `enemy`:
 * cheaper for friends and treaty partners, dearer when it likes the enemy,
 * and an honorable power asks less.
 */
export function aidPriceFor(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  me: PowerId,
  victim: PowerId,
  enemy: PowerId,
  k: PersonaKnobs,
): number {
  const op = (a: PowerId, b: PowerId): number => Math.max(-1, Math.min(1, opinionOf(state, ruleSet, world, a, b).value / 100));
  const partner = treatyBetween(state, me, victim) !== undefined ? 0.5 : 1;
  const price = DIPLOMAT.aidBasePrice * (1 - op(me, victim) * 0.6) * (1 + op(me, enemy) * 0.5) * (1 - unit(k.honor) * 0.4) * partner;
  return Math.max(0, Math.round(price / 100_000) * 100_000);
}

export class DiplomatAI implements PlayerController {
  public readonly kind = "ai" as const;

  public constructor(
    private readonly inner: PlayerController,
    private readonly ruleSet: RuleSet,
    private readonly world: WorldDefinition,
  ) {}

  public async requestActions(ctx: DecisionContext): Promise<readonly Action[]> {
    const { power } = ctx.view;
    const k = getPowerState(ctx.view.state, power).persona ?? neutralKnobs({});
    const rng = new Rng(seedFor(ctx.view.state, power));
    const pre: Action[] = [];
    let sim = ctx.view.state;
    const tryApply = (s: GameState, a: Action): GameState | null => {
      try {
        return reduce(s, a, this.ruleSet, this.world).state;
      } catch {
        return null;
      }
    };
    const commit = (a: Action): void => {
      const next = tryApply(sim, a);
      if (next !== null) {
        sim = next;
        pre.push(a);
      }
    };

    for (const call of callsTo(sim, power)) {
      commit({ type: "ANSWER_CALL", partner: call.partner, join: this.joinsCall(sim, power, call.partner, call.enemy, k) });
    }
    for (const offer of offersTo(sim, power)) {
      commit({ type: "ANSWER_PEACE", from: offer.from, accept: this.acceptsPeace(sim, power, offer, k) });
    }
    for (const p of (sim.proposals ?? []).filter((x) => x.to === power)) {
      commit({ type: "ANSWER_PROPOSAL", from: p.from, kind: p.kind, accept: this.acceptsProposal(sim, power, p, k) });
    }
    for (const a of this.proposals(sim, power, k, rng)) commit(a);
    for (const enemy of enemiesOf(sim, power)) {
      const terms = this.peaceOffer(sim, power, enemy, k, rng);
      if (terms !== null) commit({ type: "OFFER_PEACE", target: enemy, ...terms });
    }
    for (const target of this.coalitionTargets(sim, power, k, rng)) commit({ type: "JOIN_COALITION", target });

    const rolled = this.neighbours(sim, power).filter((t) => rng.next() < this.warChance(sim, power, t, k));
    if (rolled.length > 0) {
      let hypo = sim;
      const declared: PowerId[] = [];
      for (const t of rolled) {
        const next = tryApply(hypo, { type: "DECLARE_WAR", target: t });
        if (next !== null) {
          hypo = next;
          declared.push(t);
        }
      }
      if (declared.length > 0) {
        const plan = await this.inner.requestActions({ view: { ...ctx.view, state: hypo } });
        const attacked = new Set<string>();
        for (const a of plan) {
          if (a.type === "MOVE_ARMY" || a.type === "MOVE_FLEET") {
            const owner = hypo.areas[String(a.to)]?.owner;
            if (owner) attacked.add(String(owner));
          }
        }
        const kept = declared.filter((t) => attacked.has(String(t)));
        if (kept.length > 0) {
          return [...pre, ...kept.map((t): Action => ({ type: "DECLARE_WAR", target: t })), ...plan];
        }
      }
    }
    const plan = await this.inner.requestActions({ view: { ...ctx.view, state: sim } });
    return [...pre, ...plan];
  }

  private opinion(state: GameState, of: PowerId, about: PowerId): number {
    return opinionOf(state, this.ruleSet, this.world, of, about).value;
  }

  private areaCount(state: GameState, p: PowerId): number {
    return Object.values(state.areas).filter((a) => a.owner === p).length;
  }

  /** Whether to answer an ally's call to arms. Honor and friendship push to join; a far stronger enemy and other wars hold back. */
  private joinsCall(state: GameState, me: PowerId, partner: PowerId, enemy: PowerId, k: PersonaKnobs): boolean {
    const d = DIPLOMAT;
    const rep = reputationOf(state, this.ruleSet, me);
    let score = unit(k.honor) * 60 + this.opinion(state, me, partner) / 2 + 10;
    if (rep - this.ruleSet.diplomacy.refuseCallCost < 15) score += 20;
    if (this.areaCount(state, enemy) > 1.5 * this.areaCount(state, me)) score -= 25;
    score -= enemiesOf(state, me).length * 15;
    return score >= d.joinCallAt;
  }

  /** Whether to accept a pact, alliance or war-aid proposal. */
  private acceptsProposal(state: GameState, me: PowerId, p: Proposal, k: PersonaKnobs): boolean {
    const d = DIPLOMAT;
    const treasury = getPowerState(state, me).treasury;
    if (p.payment < 0 && treasury < -p.payment) return false;
    const money = p.payment / d.dollarsPerPoint;
    const op = this.opinion(state, me, p.from);
    const busy = enemiesOf(state, me).length > 0;
    if (p.kind === "pact") {
      const stronger = this.areaCount(state, p.from) > this.areaCount(state, me) ? 10 : 0;
      const score = op + money + (busy ? 15 : 0) + stronger + (unit(k.honor) - 0.5) * 10 - (unit(k.aggression) - 0.5) * 20;
      return score >= d.pactAt;
    }
    if (p.kind === "alliance") {
      const mine = enemiesOf(state, me);
      const common = enemiesOf(state, p.from).some((e) => mine.includes(e));
      return op + money >= d.allianceAt && (common || op >= d.allianceAt + 25);
    }
    // War aid. As the helper: name a price. As the victim of a war: accept help we can afford.
    const enemy = p.enemy!;
    if (isAtWar(state, me, enemy)) {
      const losing = warBalance(state, me, enemy) < 0 || this.areaCount(state, enemy) > this.areaCount(state, me);
      return losing && -p.payment <= treasury * 0.5;
    }
    if (enemiesOf(state, me).length > 1) return false;
    if (this.areaCount(state, enemy) > 1.6 * this.areaCount(state, me)) return false;
    return p.payment >= this.aidPrice(state, me, p.from, enemy, k);
  }

  private aidPrice(state: GameState, me: PowerId, victim: PowerId, enemy: PowerId, k: PersonaKnobs): number {
    return aidPriceFor(state, this.ruleSet, this.world, me, victim, enemy, k);
  }

  /** Treaties and war aid this power proposes this season. */
  private proposals(state: GameState, me: PowerId, k: PersonaKnobs, rng: Rng): Action[] {
    const d = DIPLOMAT;
    const out: Action[] = [];
    const pending = (to: PowerId, kind: Proposal["kind"]): boolean =>
      (state.proposals ?? []).some((p) => p.from === me && p.to === to && p.kind === kind);
    const others = Object.values(state.powers).filter((p) => p.id !== me && !p.eliminated && p.control !== "neutral").map((p) => p.id);
    const myEnemies = enemiesOf(state, me);
    const treasury = getPowerState(state, me).treasury;

    for (const other of others) {
      if (isAtWar(state, me, other)) continue;
      const op = this.opinion(state, me, other);
      const treaty = treatyBetween(state, me, other);
      if (treaty === undefined && op >= d.proposePactAt && !pending(other, "pact")) {
        if (rng.next() < d.pactChance + (myEnemies.length > 0 ? d.pactChance : 0)) {
          const years = this.ruleSet.diplomacy.pactYears[rng.int(this.ruleSet.diplomacy.pactYears.length)]!;
          out.push({ type: "PROPOSE", to: other, kind: "pact", payment: 0, years, enemy: null });
        }
      }
      const common = enemiesOf(state, other).some((e) => myEnemies.includes(e));
      if (treaty?.kind !== "alliance" && (common || op >= d.allianceAt + 25) && op >= d.allianceAt && !pending(other, "alliance") && rng.next() < d.allianceChance) {
        out.push({ type: "PROPOSE", to: other, kind: "alliance", payment: 0, years: 0, enemy: null });
      }
    }

    // Losing a war: ask a friend to join, for money.
    for (const enemy of myEnemies) {
      if (warBalance(state, me, enemy) >= d.askAidBelow || rng.next() > d.askAidChance) continue;
      const helper = others
        .filter((o) => o !== enemy && !isAtWar(state, o, enemy) && !isAtWar(state, o, me) && truceUntil(state, o, enemy) === null)
        .sort((a, b) => this.opinion(state, me, b) - this.opinion(state, me, a))[0];
      if (helper === undefined || pending(helper, "aid")) continue;
      const payment = Math.round(Math.min(treasury * 0.5, d.aidBasePrice) / 100_000) * 100_000;
      out.push({ type: "PROPOSE", to: helper, kind: "aid", payment, years: 0, enemy });
    }

    // A friend is at war with someone we dislike: offer to join, for a price.
    for (const friend of others) {
      if (isAtWar(state, me, friend) || this.opinion(state, me, friend) < d.offerAidFriendAt || pending(friend, "aid")) continue;
      for (const enemy of enemiesOf(state, friend)) {
        if (enemy === me || isAtWar(state, me, enemy) || truceUntil(state, me, enemy) !== null) continue;
        if (this.opinion(state, me, enemy) >= 0 || myEnemies.length > 0 || rng.next() > d.offerAidChance) continue;
        out.push({ type: "PROPOSE", to: friend, kind: "aid", payment: -this.aidPrice(state, me, friend, enemy, k), years: 0, enemy });
        break;
      }
    }
    return out;
  }

  /** Great powers this power borders by land, or shares a sea region's ports with. */
  private neighbours(state: GameState, power: PowerId): PowerId[] {
    const out = new Set<string>();
    const myPortRegions = new Set<number>();
    for (const a of Object.values(state.areas)) {
      if (a.owner !== power) continue;
      const def = getArea(this.world, a.id);
      if (def.isPort) myPortRegions.add(Number(def.region));
      for (const nb of neighborsOf(this.world, a.id)) {
        const o = state.areas[String(nb)]?.owner;
        if (o && o !== power) out.add(String(o));
      }
    }
    for (const a of Object.values(state.areas)) {
      if (!a.owner || a.owner === power) continue;
      const def = getArea(this.world, a.id);
      if (def.isPort && myPortRegions.has(Number(def.region))) out.add(String(a.owner));
    }
    return [...out]
      .map((id) => id as PowerId)
      .filter((t) => warBlocker(state, power, t) === null && getPowerState(state, t).control !== "neutral");
  }

  private neutralBorders(state: GameState, power: PowerId): number {
    const seen = new Set<number>();
    for (const a of Object.values(state.areas)) {
      if (a.owner !== power) continue;
      for (const nb of neighborsOf(this.world, a.id)) {
        if (state.areas[String(nb)]?.owner === null) seen.add(Number(nb));
      }
    }
    return seen.size;
  }

  /** Per-season chance that `me` declares war on neighbour `t`. Exported logic for the rules page. */
  public warChance(state: GameState, me: PowerId, t: PowerId, k: PersonaKnobs): number {
    const d = DIPLOMAT;
    if (truceUntil(state, me, t) !== null) return 0;
    let p = d.baseWarChance + d.aggressionWarChance * unit(k.aggression);

    const free = this.neutralBorders(state, me);
    p *= free === 0 ? d.hungerNone : free <= 2 ? d.hungerFew : free <= 5 ? d.hungerSome : d.hungerPlenty;

    const opp = unit(k.opportunism);
    const count = (id: PowerId): number => Object.values(state.areas).filter((a) => a.owner === id).length;
    const ratio = count(me) / Math.max(1, count(t));
    p *= 1 + opp * Math.min(2, Math.max(0, ratio - 1));
    p *= 1 + opp * 0.8 * enemiesOf(state, t).length;

    const scores = Object.values(state.powers).filter((x) => !x.eliminated).map((x) => x.score).sort((a, b) => b - a);
    const tScore = getPowerState(state, t).score;
    if (tScore > 50 && tScore === scores[0] && tScore >= 1.25 * (scores[1] ?? 0)) p *= d.leaderBonus;

    const rs = this.ruleSet;
    if (reputationOf(state, rs, t) < rs.diplomacy.pariahBelow) p *= d.pariahBonus;

    const hon = unit(k.honor);
    p *= 1.3 - hon;
    const after = reputationOf(state, rs, me) - declareWarCost(state, rs, me, t);
    if (after < 20) p *= 1 - hon;

    p *= d.perOpenWar ** enemiesOf(state, me).length;
    p *= Math.max(0.25, Math.min(2, 1 - this.opinion(state, me, t) / 120));
    const treaty = treatyBetween(state, me, t);
    if (treaty?.kind === "pact") p *= d.pactWarFactor * (1 - hon);
    if (treaty?.kind === "alliance") p *= d.allyWarFactor * (1 - hon);
    if (state.year === 1) p *= d.firstYear;
    return Math.max(0, Math.min(d.maxWarChance, p));
  }

  /** Whether `me` accepts `offer`. Positive score = peace is worth more than fighting on. */
  private acceptsPeace(state: GameState, me: PowerId, offer: PeaceOffer, k: PersonaKnobs): boolean {
    if (offer.payment < 0 && getPowerState(state, me).treasury < -offer.payment) return false;
    const land = this.landPoints(state, me, offer.cede ?? [], offer.demand ?? []);
    return this.peaceScore(state, me, offer.from, offer.payment, k) + land - this.desertion(state, me, offer.from, k) >= 0;
  }

  /** Net worth to `me` of land it gains (`gets`) and gives up (`gives`), in war points. */
  private landPoints(state: GameState, me: PowerId, gets: readonly AreaId[], gives: readonly AreaId[]): number {
    const d = DIPLOMAT;
    const gain = gets.reduce((n, a) => n + landWorth(state, a), 0);
    const loss = gives.reduce((n, a) => n + landWorth(state, a) * d.landLossAversion * (state.areas[String(a)]?.homeOf === me ? 2 : 1), 0);
    return gain - loss;
  }

  /** Reluctance to make a separate peace with a coalition's target while partners still fight. */
  private desertion(state: GameState, me: PowerId, enemy: PowerId, k: PersonaKnobs): number {
    const c = coalitionAgainst(state, enemy);
    if (c === undefined || !c.members.includes(me)) return 0;
    const partners = c.members.filter((m) => m !== me && isAtWar(state, m, enemy)).length;
    return partners === 0 ? 0 : this.ruleSet.diplomacy.coalitionDesertCost * (0.5 + unit(k.honor));
  }

  /** Pariahs this power joins a coalition against this season. */
  private coalitionTargets(state: GameState, me: PowerId, k: PersonaKnobs, rng: Rng): PowerId[] {
    const d = DIPLOMAT;
    const out: PowerId[] = [];
    const near = new Set(this.neighbours(state, me).map(String));
    for (const enemy of enemiesOf(state, me)) near.add(String(enemy));
    for (const p of Object.values(state.powers)) {
      const t = p.id;
      if (coalitionBlocker(state, this.ruleSet, me, t) !== null) continue;
      const members = coalitionAgainst(state, t)?.members.length ?? 0;
      if (!near.has(String(t)) && members === 0) continue;
      if (this.opinion(state, me, t) > 0) continue;
      const atWar = isAtWar(state, me, t);
      let chance = d.coalitionChance + d.coalitionHonor * unit(k.honor) + d.coalitionPerMember * members;
      if (atWar) chance *= 2;
      else chance *= d.perOpenWar ** enemiesOf(state, me).length;
      if (!atWar && this.areaCount(state, t) > 1.5 * this.areaCount(state, me) && members === 0) chance *= 0.3;
      if (rng.next() < Math.min(d.coalitionMax, chance)) out.push(t);
    }
    return out;
  }

  /** How much `me` wants peace with `enemy` if it receives `received` dollars (negative: it pays). */
  private peaceScore(state: GameState, me: PowerId, enemy: PowerId, received: number, k: PersonaKnobs): number {
    const d = DIPLOMAT;
    const balance = warBalance(state, me, enemy);
    const len = warLength(state, me, enemy);
    const others = enemiesOf(state, me).length - 1;
    return (
      received / d.dollarsPerPoint +
      len * d.wearinessPerSeason +
      others * d.otherWarPressure -
      balance * (0.5 + unit(k.aggression)) -
      6 +
      (unit(k.honor) - 0.5) * 10
    );
  }

  /** A peace offer to make this season (money the AI pays, negative = tribute it demands, and land), or null. */
  private peaceOffer(state: GameState, me: PowerId, enemy: PowerId, k: PersonaKnobs, rng: Rng): PeaceTerms | null {
    const d = DIPLOMAT;
    if ((state.peaceOffers ?? []).some((o) => o.from === me && o.to === enemy)) return null;
    const balance = warBalance(state, me, enemy);
    const len = warLength(state, me, enemy);
    const treasury = getPowerState(state, me).treasury;
    const round = (x: number): number => Math.max(0, Math.round(x / 100_000) * 100_000);
    const deserting = this.desertion(state, me, enemy, k) > 0;
    if (balance <= d.sueBelow) {
      if (deserting && balance > 2 * d.sueBelow) return null;
      // Sue for peace now and then, offering roughly what the winner needs to hear.
      if (rng.next() > (balance <= 2 * d.sueBelow ? 0.5 : 0.25)) return null;
      const owed = -balance;
      const cash = Math.min(round(treasury * 0.6), round(owed * d.dollarsPerPoint));
      const short = owed - cash / d.dollarsPerPoint;
      if (short > 10 && rng.next() < 0.5) {
        // Not enough money: give up the cheapest border land instead.
        const land = this.borderLand(state, me, enemy).sort((a, b) => landWorth(state, a) - landWorth(state, b))[0];
        if (land !== undefined && landWorth(state, land) <= short * 1.5) {
          const rest = Math.max(0, owed - landWorth(state, land));
          return { payment: Math.min(cash, round(rest * d.dollarsPerPoint)), cede: [land], demand: [] };
        }
      }
      return { payment: cash, cede: [], demand: [] };
    }
    if (deserting) return null;
    if (len >= 8 && Math.abs(balance) < 10 && this.peaceScore(state, me, enemy, 0, k) >= 0) {
      return rng.next() < 0.2 ? { payment: 0, cede: [], demand: [] } : null;
    }
    if (balance >= 25 && len >= 4 && rng.next() < 0.15 * (1 - unit(k.honor) * 0.5)) {
      if (rng.next() < d.demandLandChance) {
        // Ask for the richest border land the war has earned.
        const demand: AreaId[] = [];
        let budget = balance * 0.8;
        for (const a of this.borderLand(state, enemy, me).sort((x, y) => landWorth(state, y) - landWorth(state, x))) {
          if (demand.length >= Math.min(2, this.ruleSet.diplomacy.maxCededAreas) || landWorth(state, a) > budget) continue;
          demand.push(a);
          budget -= landWorth(state, a);
        }
        if (demand.length > 0) return { payment: 0, cede: [], demand };
      }
      return { payment: -Math.min(3_000_000, round(balance * 40_000)), cede: [], demand: [] };
    }
    return null;
  }

  /** Areas `giver` could hand over that border land held by `taker`. */
  private borderLand(state: GameState, giver: PowerId, taker: PowerId): AreaId[] {
    return tradeableAreas(state, giver).filter((a) => neighborsOf(this.world, a).some((n) => state.areas[String(n)]?.owner === taker));
  }
}
