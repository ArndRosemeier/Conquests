import { useEffect, useState } from "react";
import type React from "react";
import { aidPriceFor } from "../../controllers/ai/diplomat.ts";
import {
  callsTo,
  coalitionAgainst,
  coalitionBlocker,
  declareWarCost,
  tradeableAreas,
  offersTo,
  proposalBlocker,
  reputationOf,
  treatyBetween,
  truceUntil,
  warBalance,
  warBlocker,
} from "../../engine/state/diplomacy.ts";
import type { GameState, PeaceOffer, Proposal } from "../../engine/state/gameState.ts";
import { enemiesOf, getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { nowSeason } from "../../engine/state/knowledge.ts";
import { opinionOf } from "../../engine/state/opinion.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import { getArea, neighborsOf } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import { leaderLine, leaderOf } from "../content/leaders.ts";
import { lookOf, money, powerName } from "../content/powers.ts";
import { useGame } from "../store.ts";

/** "Spring 1884" for an absolute season index. */
export function seasonLabel(gs: { startYear: number }, abs: number): string {
  const year = Math.floor(abs / 4);
  const season = ["Spring", "Summer", "Fall", "Winter"][abs % 4]!;
  return `${season} ${gs.startYear + year - 1}`;
}

/** Payment terms from the point of view of whoever reads them. */
export function termsLabel(payment: number, mine: boolean): string {
  if (payment === 0) return "no payment";
  if (payment > 0) return mine ? `you pay ${money(payment)}` : `they pay you ${money(payment)}`;
  return mine ? `you ask ${money(-payment)}` : `they ask ${money(-payment)}`;
}

const AID_PAYMENTS = [0, 1_000_000, 2_000_000, 4_000_000];

const areaNames = (world: WorldDefinition, ids: readonly AreaId[]): string => ids.map((id) => getArea(world, id).name).join(", ");

/** Full terms of a peace offer (money and land), from the point of view of `me`. */
export function peaceTermsLabel(offer: PeaceOffer, me: PowerId, world: WorldDefinition): string {
  const mine = offer.from === me;
  const parts = [termsLabel(offer.payment, mine)];
  const cede = offer.cede ?? [];
  const demand = offer.demand ?? [];
  if (cede.length > 0) parts.push(mine ? `you hand over ${areaNames(world, cede)}` : `they hand over ${areaNames(world, cede)}`);
  if (demand.length > 0) parts.push(mine ? `you ask for ${areaNames(world, demand)}` : `you hand over ${areaNames(world, demand)}`);
  if (parts.length > 1 && offer.payment === 0) parts.shift();
  return parts.join(" · ");
}

const PEACE_MONEY = [-3_000_000, -1_000_000, 0, 500_000, 1_000_000, 2_000_000, 4_000_000];

/**
 * Compose a peace offer: money either way, and up to the treaty limit of areas
 * each way. Only land bordering the other side is listed (plus `focus`).
 */
export function PeaceComposer({ target, focus }: { target: PowerId; focus?: AreaId }): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const play = useGame((s) => s.play);
  const [payment, setPayment] = useState(0);
  const [demand, setDemand] = useState<readonly AreaId[]>([]);
  const [cede, setCede] = useState<readonly AreaId[]>([]);
  if (gs === null || me === null) return null;
  const max = ruleSet.diplomacy.maxCededAreas;
  const treasury = getPowerState(gs, me).treasury;
  const borders = (giver: PowerId, taker: PowerId): AreaId[] =>
    tradeableAreas(gs, giver)
      .filter((a) => a === focus || neighborsOf(world, a).some((n) => gs.areas[String(n)]?.owner === taker))
      .sort((a, b) => getArea(world, a).name.localeCompare(getArea(world, b).name));
  const askable = borders(target, me);
  const givable = borders(me, target);
  const toggle = (list: readonly AreaId[], set: (v: readonly AreaId[]) => void, id: AreaId): void =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);
  const money$ = PEACE_MONEY.filter((a) => a <= treasury);
  const label = (a: number): string => (a === 0 ? "No money" : a > 0 ? `Pay ${money(a)}` : `Demand ${money(-a)}`);
  return (
    <div className="peace-composer">
      <div className="chips">
        {money$.map((a) => (
          <button key={a} className={`chip${payment === a ? " on" : ""}`} onClick={() => setPayment(a)}>{label(a)}</button>
        ))}
      </div>
      {askable.length > 0 && (
        <>
          <small className="hint">Ask for land (up to {max}):</small>
          <div className="chips">
            {askable.map((a) => (
              <button key={String(a)} className={`chip${demand.includes(a) ? " on" : ""}`} onClick={() => toggle(demand, setDemand, a)}>{getArea(world, a).name}</button>
            ))}
          </div>
        </>
      )}
      {givable.length > 0 && (
        <>
          <small className="hint">Hand over land:</small>
          <div className="chips">
            {givable.map((a) => (
              <button key={String(a)} className={`chip${cede.includes(a) ? " on" : ""}`} onClick={() => toggle(cede, setCede, a)}>{getArea(world, a).name}</button>
            ))}
          </div>
        </>
      )}
      <button
        className="btn small primary"
        onClick={() => play({ type: "OFFER_PEACE", target, payment, cede, demand })}
      >
        Send peace offer
      </button>
    </div>
  );
}

function statusOf(gs: GameState, me: PowerId, other: PowerId): { label: string; tone: string } {
  if (isAtWar(gs, me, other)) return { label: "At war", tone: "war" };
  const t = treatyBetween(gs, me, other);
  if (t?.kind === "alliance") return { label: "Allies", tone: "ally" };
  if (t?.kind === "pact") return { label: `Pact until ${seasonLabel(gs, t.until!)}`, tone: "pact" };
  const truce = truceUntil(gs, me, other);
  if (truce !== null) return { label: `Truce until ${seasonLabel(gs, truce)}`, tone: "pact" };
  return { label: "Peace", tone: "peace" };
}

function proposalLabel(p: Proposal, names: (id: PowerId | null) => string): string {
  if (p.kind === "pact") return `a ${p.years}-year non-aggression pact`;
  if (p.kind === "alliance") return "an alliance";
  return `war aid against ${names(p.enemy)}`;
}

/** The Diplomacy panel: every power, where you stand with it, and what you can propose. */
export function DiplomacyPanel(): React.JSX.Element | null {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const play = useGame((s) => s.play);
  const close = (): void => setPanel("none");
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (panel !== "diplomacy" || gs === null || me === null) return null;

  const yourTurn = gs.stage === "PLAYER" && gs.activePower === me && gs.winner === null;
  const names = (id: PowerId | null): string => powerName(ruleSet.powers, id);
  const treasury = getPowerState(gs, me).treasury;
  const myEnemies = enemiesOf(gs, me);
  const others = ruleSet.playOrder.filter((id) => id !== me && !getPowerState(gs, id).eliminated && getPowerState(gs, id).control !== "neutral");
  const mySent = (to: PowerId): readonly Proposal[] => (gs.proposals ?? []).filter((p) => p.from === me && p.to === to);

  return (
    <div className="overlay" onClick={close}>
      <div className="modal glass diplomacy-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" aria-label="Close" onClick={close}>×</button>
        <h2>Diplomacy</h2>
        <p className="hint">
          Your reputation: <b>{reputationOf(gs, ruleSet, me)}</b> of {ruleSet.diplomacy.reputationMax}.
          {!yourTurn && " You can make proposals on your turn."}
        </p>
        <Coalitions />
        <div className="dip-list">
          {others.map((id) => {
            const st = statusOf(gs, me, id);
            const ps = getPowerState(gs, id);
            const opinion = ps.control === "ai" ? opinionOf(gs, ruleSet, world, id, me) : null;
            const treaty = treatyBetween(gs, me, id);
            const atWar = isAtWar(gs, me, id);
            const sent = mySent(id);
            const myOffer = (gs.peaceOffers ?? []).find((o) => o.from === me && o.to === id);
            const peaceSent = myOffer !== undefined;
            const can = (kind: Proposal["kind"], enemy: PowerId | null = null, years = 0): boolean =>
              yourTurn && proposalBlocker(gs, ruleSet, me, id, kind, enemy, years) === null;
            const aidTargets = myEnemies.filter((e) => e !== id && can("aid", e));
            const leader = leaderOf(id, gs.startYear);
            const line = opinion && leader
              ? leaderLine({
                  atWar,
                  balance: warBalance(gs, id, me),
                  treaty: treaty?.kind ?? null,
                  inCoalitionAgainstYou: coalitionAgainst(gs, me)?.members.includes(id) ?? false,
                  opinion: opinion.value,
                })
              : null;
            return (
              <section key={String(id)} className={`dip-row tone-${st.tone}`}>
                <header>
                  <div className="dip-portrait">
                    <img src={leader?.portrait ?? lookOf(String(id)).crest} alt={leader?.name ?? ""} />
                    {leader && <img className="dip-crest" src={lookOf(String(id)).crest} alt="" />}
                  </div>
                  <div>
                    <b>{names(id)}</b>
                    {leader && <small>{leader.name}, {leader.title}</small>}
                    <small>{ps.control === "human" ? "player" : "computer"} · reputation {reputationOf(gs, ruleSet, id)}</small>
                  </div>
                  <span className={`dip-status ${st.tone}`}>{st.label}</span>
                </header>
                {line && <blockquote className="dip-line">“{line}”</blockquote>}
                {opinion && (
                  <div className="dip-opinion">
                    <span>Thinks of you: <b className={opinion.value >= 0 ? "good" : "bad"}>{opinion.value > 0 ? "+" : ""}{opinion.value}</b></span>
                    <small>{opinion.reasons.map((r) => `${r.label} ${r.value > 0 ? "+" : ""}${r.value}`).join(" · ") || "No strong feelings"}</small>
                  </div>
                )}
                {atWar && <p className="hint">War balance {warBalance(gs, me, id) > 0 ? "+" : ""}{warBalance(gs, me, id)}.</p>}
                {sent.map((p) => (
                  <p key={p.kind} className="hint">You proposed {proposalLabel(p, names)} ({termsLabel(p.payment, true)}). They answer on their turn.</p>
                ))}
                {yourTurn && (
                  <div className="chips">
                    {atWar && myOffer && <span className="hint">Peace offer sent ({peaceTermsLabel(myOffer, me, world)}).</span>}
                    {!atWar && ruleSet.diplomacy.pactYears.map((y) =>
                      can("pact", null, y) && !sent.some((p) => p.kind === "pact") ? (
                        <button key={y} className="chip" onClick={() => play({ type: "PROPOSE", to: id, kind: "pact", payment: 0, years: y, enemy: null })}>
                          Propose {y}-year pact
                        </button>
                      ) : null,
                    )}
                    {can("alliance") && !sent.some((p) => p.kind === "alliance") && (
                      <button className="chip" onClick={() => play({ type: "PROPOSE", to: id, kind: "alliance", payment: 0, years: 0, enemy: null })}>Propose alliance</button>
                    )}
                    {treaty?.kind === "alliance" && (
                      <button className="chip" onClick={() => play({ type: "LEAVE_ALLIANCE", ally: id })}>Leave alliance (reputation −{ruleSet.diplomacy.leaveAllianceCost})</button>
                    )}
                    {!atWar && warBlocker(gs, me, id) === null && (
                      <button className="chip danger" onClick={() => play({ type: "DECLARE_WAR", target: id })}>
                        Declare war (reputation −{declareWarCost(gs, ruleSet, me, id)})
                      </button>
                    )}
                  </div>
                )}
                {yourTurn && atWar && !peaceSent && <PeaceComposer target={id} />}
                {yourTurn && aidTargets.map((enemy) => {
                  const price = ps.control === "ai" && ps.persona ? aidPriceFor(gs, ruleSet, world, id, me, enemy, ps.persona) : null;
                  if (sent.some((p) => p.kind === "aid")) return null;
                  return (
                    <div key={String(enemy)} className="dip-aid">
                      <span className="hint">
                        Ask {names(id)} to join your war against {names(enemy)}{price !== null ? ` (they want about ${money(price)})` : ""}:
                      </span>
                      <div className="chips">
                        {AID_PAYMENTS.filter((a) => a <= treasury).map((a) => (
                          <button key={a} className="chip" onClick={() => play({ type: "PROPOSE", to: id, kind: "aid", payment: a, years: 0, enemy })}>
                            {a === 0 ? "Ask for free" : `Offer ${money(a)}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Coalitions in force, and pariahs a coalition could be founded against. */
function Coalitions(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const play = useGame((s) => s.play);
  if (gs === null || me === null) return null;
  const d = ruleSet.diplomacy;
  const names = (id: PowerId | null): string => powerName(ruleSet.powers, id);
  const yourTurn = gs.stage === "PLAYER" && gs.activePower === me && gs.winner === null;
  const pariahs = ruleSet.playOrder.filter((id) => {
    const p = getPowerState(gs, id);
    return !p.eliminated && p.control !== "neutral" && (coalitionAgainst(gs, id) !== undefined || reputationOf(gs, ruleSet, id) < d.pariahBelow);
  });
  if (pariahs.length === 0) return null;
  return (
    <div className="dip-coalitions">
      {pariahs.map((t) => {
        const c = coalitionAgainst(gs, t);
        const blocker = coalitionBlocker(gs, ruleSet, me, t);
        const cost = isAtWar(gs, me, t) ? 0 : declareWarCost(gs, ruleSet, me, t);
        return (
          <div key={String(t)} className="dip-coalition">
            <span>
              {t === me ? (
                <b>{c ? `A coalition has formed against you: ${c.members.map(names).join(", ")}.` : "Your reputation is so low that others may band together against you."}</b>
              ) : (
                <>
                  <b>{c ? `Coalition against ${names(t)}` : `${names(t)} is a pariah`}</b>
                  {c ? `: ${c.members.map(names).join(", ")}.` : ` (reputation ${reputationOf(gs, ruleSet, t)}). Anyone may found a coalition against it.`}
                </>
              )}
              <small className="hint"> A coalition lasts until its target's reputation is back to {d.coalitionEndsAt}. Leaving it by a separate peace costs {d.coalitionDesertCost} reputation.</small>
            </span>
            {t !== me && yourTurn && blocker === null && (
              <button className="chip danger" onClick={() => play({ type: "JOIN_COALITION", target: t })}>
                {c ? "Join" : "Found"} the coalition (reputation {d.coalitionJoinGain - cost >= 0 ? "+" : "−"}{Math.abs(d.coalitionJoinGain - cost)}{isAtWar(gs, me, t) ? "" : ", war"})
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Everything waiting for the player's answer: peace offers, proposals and calls to arms. */
export function Inbox(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const play = useGame((s) => s.play);
  if (gs === null || me === null || gs.stage !== "PLAYER" || gs.activePower !== me || gs.winner !== null) return null;
  const face = (id: PowerId): React.JSX.Element => {
    const l = leaderOf(id, gs.startYear);
    return <img className="inbox-face" src={l?.portrait ?? lookOf(String(id)).crest} alt={l?.name ?? ""} title={l?.name} />;
  };
  const names = (id: PowerId | null): string => powerName(ruleSet.powers, id);
  const calls = callsTo(gs, me);
  const peace = offersTo(gs, me);
  const proposals = (gs.proposals ?? []).filter((p) => p.to === me);
  if (calls.length + peace.length + proposals.length === 0) return null;
  const d = ruleSet.diplomacy;
  const now = nowSeason(gs);
  return (
    <div className="peace-offers glass">
      {calls.map((c) => (
        <div key={`c${String(c.partner)}`} className="buy peace-answer call">
          <div className="buy-head">
            <span className="action-icon">📯</span>
            <span className="action-text">
              <b>{names(c.enemy)} declared war on your ally {names(c.partner)}</b>
              <small>
                Join: war with {names(c.enemy)}, reputation +{d.answerCallGain}. Refuse: reputation −{d.refuseCallCost} and the alliance ends.
                You must answer before ending your turn.
              </small>
            </span>
          </div>
          <div className="chips">
            <button className="chip accept" onClick={() => play({ type: "ANSWER_CALL", partner: c.partner, join: true })}>Join the war</button>
            <button className="chip" onClick={() => play({ type: "ANSWER_CALL", partner: c.partner, join: false })}>Refuse</button>
          </div>
        </div>
      ))}
      {peace.map((o) => (
        <div key={`p${String(o.from)}`} className="buy peace-answer">
          <div className="buy-head">
            {face(o.from)}
            <span className="action-text">
              <b>{names(o.from)} offers peace</b>
              <small>Terms: {peaceTermsLabel(o, me, world)}. Then {d.truceSeasons / 4} years of truce.</small>
            </span>
          </div>
          <div className="chips">
            <button className="chip accept" onClick={() => play({ type: "ANSWER_PEACE", from: o.from, accept: true })}>Accept</button>
            <button className="chip" onClick={() => play({ type: "ANSWER_PEACE", from: o.from, accept: false })}>Refuse</button>
          </div>
        </div>
      ))}
      {proposals.map((p) => {
        const helperIsMe = p.kind === "aid" && p.enemy !== null && !isAtWar(gs, me, p.enemy);
        return (
          <div key={`${p.kind}${String(p.from)}`} className="buy peace-answer">
            <div className="buy-head">
              {face(p.from)}
              <span className="action-text">
                <b>
                  {p.kind === "aid"
                    ? helperIsMe
                      ? `${names(p.from)} asks you to join its war against ${names(p.enemy)}`
                      : `${names(p.from)} offers to join your war against ${names(p.enemy)}`
                    : `${names(p.from)} proposes ${proposalLabel(p, names)}`}
                </b>
                <small>Terms: {termsLabel(p.payment, false)}. Open until {seasonLabel(gs, Math.max(p.expires, now))}.</small>
              </span>
            </div>
            <div className="chips">
              <button className="chip accept" onClick={() => play({ type: "ANSWER_PROPOSAL", from: p.from, kind: p.kind, accept: true })}>Accept</button>
              <button className="chip" onClick={() => play({ type: "ANSWER_PROPOSAL", from: p.from, kind: p.kind, accept: false })}>Refuse</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
