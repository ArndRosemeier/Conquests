import type { Action } from "../../engine/state/actions.ts";
import {
  declareWarCost,
  offersTo,
  reputationOf,
  truceUntil,
  warBalance,
  warBlocker,
  warLength,
} from "../../engine/state/diplomacy.ts";
import type { GameState, PeaceOffer, PersonaKnobs } from "../../engine/state/gameState.ts";
import { enemiesOf, getPowerState } from "../../engine/state/helpers.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { Rng } from "../../engine/state/rng.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { PowerId } from "../../engine/types.ts";
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
} as const;

const unit = (v: number | undefined): number => Math.max(0, Math.min(1, (v ?? NEUTRAL_KNOB) / 100));

function seedFor(state: GameState, power: PowerId): number {
  let h = state.rngState ^ Math.imul(state.tick + 1, 0x9e3779b1);
  for (const ch of String(power)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
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

    for (const offer of offersTo(sim, power)) {
      commit({ type: "ANSWER_PEACE", from: offer.from, accept: this.acceptsPeace(sim, power, offer, k) });
    }
    for (const enemy of enemiesOf(sim, power)) {
      const payment = this.peaceOffer(sim, power, enemy, k, rng);
      if (payment !== null) commit({ type: "OFFER_PEACE", target: enemy, payment });
    }

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
    const after = reputationOf(state, rs, me) - declareWarCost(state, rs, t);
    if (after < 20) p *= 1 - hon;

    p *= d.perOpenWar ** enemiesOf(state, me).length;
    if (state.year === 1) p *= d.firstYear;
    return Math.max(0, Math.min(d.maxWarChance, p));
  }

  /** Whether `me` accepts `offer`. Positive score = peace is worth more than fighting on. */
  private acceptsPeace(state: GameState, me: PowerId, offer: PeaceOffer, k: PersonaKnobs): boolean {
    if (offer.payment < 0 && getPowerState(state, me).treasury < -offer.payment) return false;
    return this.peaceScore(state, me, offer.from, offer.payment, k) >= 0;
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

  /** A peace offer to make this season (payment the AI pays; negative = tribute it demands), or null. */
  private peaceOffer(state: GameState, me: PowerId, enemy: PowerId, k: PersonaKnobs, rng: Rng): number | null {
    const d = DIPLOMAT;
    if ((state.peaceOffers ?? []).some((o) => o.from === me && o.to === enemy)) return null;
    const balance = warBalance(state, me, enemy);
    const len = warLength(state, me, enemy);
    const treasury = getPowerState(state, me).treasury;
    const round = (x: number): number => Math.max(0, Math.round(x / 100_000) * 100_000);
    if (balance <= d.sueBelow) {
      // Sue for peace now and then, offering roughly what the winner needs to hear.
      if (rng.next() > (balance <= 2 * d.sueBelow ? 0.5 : 0.25)) return null;
      return Math.min(round(treasury * 0.6), round(-balance * d.dollarsPerPoint));
    }
    if (len >= 8 && Math.abs(balance) < 10 && this.peaceScore(state, me, enemy, 0, k) >= 0) {
      return rng.next() < 0.2 ? 0 : null;
    }
    if (balance >= 25 && len >= 4 && rng.next() < 0.15 * (1 - unit(k.honor) * 0.5)) {
      return -Math.min(3_000_000, round(balance * 40_000));
    }
    return null;
  }
}
