import { useEffect } from "react";
import type React from "react";
import { aidPriceFor } from "../../controllers/ai/diplomat.ts";
import {
  callsTo,
  declareWarCost,
  offersTo,
  proposalBlocker,
  reputationOf,
  treatyBetween,
  truceUntil,
  warBalance,
  warBlocker,
} from "../../engine/state/diplomacy.ts";
import type { GameState, Proposal } from "../../engine/state/gameState.ts";
import { enemiesOf, getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { nowSeason } from "../../engine/state/knowledge.ts";
import { opinionOf } from "../../engine/state/opinion.ts";
import type { PowerId } from "../../engine/types.ts";
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

const PEACE_PAYMENTS = [500_000, 1_000_000, 2_000_000, 4_000_000];
const AID_PAYMENTS = [0, 1_000_000, 2_000_000, 4_000_000];

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
        <div className="dip-list">
          {others.map((id) => {
            const st = statusOf(gs, me, id);
            const ps = getPowerState(gs, id);
            const opinion = ps.control === "ai" ? opinionOf(gs, ruleSet, world, id, me) : null;
            const treaty = treatyBetween(gs, me, id);
            const atWar = isAtWar(gs, me, id);
            const sent = mySent(id);
            const peaceSent = (gs.peaceOffers ?? []).some((o) => o.from === me && o.to === id);
            const can = (kind: Proposal["kind"], enemy: PowerId | null = null, years = 0): boolean =>
              yourTurn && proposalBlocker(gs, ruleSet, me, id, kind, enemy, years) === null;
            const aidTargets = myEnemies.filter((e) => e !== id && can("aid", e));
            return (
              <section key={String(id)} className={`dip-row tone-${st.tone}`}>
                <header>
                  <img src={lookOf(String(id)).crest} alt="" />
                  <div>
                    <b>{names(id)}</b>
                    <small>{ps.control === "human" ? "player" : "computer"} · reputation {reputationOf(gs, ruleSet, id)}</small>
                  </div>
                  <span className={`dip-status ${st.tone}`}>{st.label}</span>
                </header>
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
                    {atWar && !peaceSent && (
                      <>
                        <button className="chip" onClick={() => play({ type: "OFFER_PEACE", target: id, payment: 0 })}>Offer peace</button>
                        {PEACE_PAYMENTS.filter((a) => a <= treasury).map((a) => (
                          <button key={a} className="chip" onClick={() => play({ type: "OFFER_PEACE", target: id, payment: a })}>Peace, pay {money(a)}</button>
                        ))}
                      </>
                    )}
                    {atWar && peaceSent && <span className="hint">Peace offer sent.</span>}
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

/** Everything waiting for the player's answer: peace offers, proposals and calls to arms. */
export function Inbox(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const play = useGame((s) => s.play);
  if (gs === null || me === null || gs.stage !== "PLAYER" || gs.activePower !== me || gs.winner !== null) return null;
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
            <span className="action-icon">🕊</span>
            <span className="action-text">
              <b>{names(o.from)} offers peace</b>
              <small>Terms: {termsLabel(o.payment, false)}. Then {d.truceSeasons / 4} years of truce.</small>
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
              <span className="action-icon">{p.kind === "aid" ? "⚔" : "📜"}</span>
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
