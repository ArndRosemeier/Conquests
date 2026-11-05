import { useEffect, useState } from "react";
import type React from "react";
import { getPowerDef } from "../../engine/ruleset/classic.ts";
import { getAreaState, getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { perceive } from "../../engine/state/knowledge.ts";
import { canBuild, canDiplomacy, canEspionage, canSubvert } from "../../engine/state/legalActions.ts";
import { isFoundingTurn } from "../../engine/state/phases.ts";
import type { AreaId } from "../../engine/types.ts";
import { getArea } from "../../engine/world/classic.ts";
import { lookOf, money, powerColor, powerName, troops } from "../content/powers.ts";
import { intelAgeLabel, terrainLabel } from "../labels.ts";
import { useGame } from "../store.ts";

/** The selected area: what it is, what you know about it, and what you can do there. */
export function AreaPanel(): React.JSX.Element | null {
  const selected = useGame((s) => s.selected);
  const move = useGame((s) => s.move);
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const select = useGame((s) => s.select);

  if (gs === null) return null;
  if (move !== null) return <MovePanel />;
  if (selected === null) return null;

  const st = getAreaState(gs, selected);
  const def = getArea(world, selected);
  const view = me === null ? { kind: "unknown" as const } : perceive(gs, me, selected);
  const owner = st.owner === null ? null : String(st.owner);
  const color = powerColor(ruleSet.powers, owner);
  const yourTurn = me !== null && gs.stage === "PLAYER" && gs.activePower === me && gs.winner === null;

  return (
    <aside className="area-panel glass" key={String(selected)} style={{ ["--owner" as string]: color }}>
      <button className="close" aria-label="Close" onClick={() => select(null)}>×</button>
      <header className="area-head">
        {owner !== null ? <img src={lookOf(owner).crest} alt="" className="area-crest" /> : <div className="area-crest neutral">⚑</div>}
        <div>
          <h2>{def.name}</h2>
          <div className="area-owner">{owner === null ? "Independent country" : owner === String(me) ? "Your territory" : powerName(ruleSet.powers, owner)}</div>
        </div>
      </header>
      <div className="area-facts">
        <Fact label="Garrison" value={view.kind === "unknown" ? "Unknown" : `${view.kind === "report" ? "~" : ""}${view.troops.toLocaleString()}`} hint={view.kind === "report" ? `spied ${intelAgeLabel(view.ageSeasons)}` : view.kind === "unknown" ? "spy to find out" : undefined} />
        <Fact label="Fleets" value={view.kind === "unknown" ? "?" : String(view.fleets)} />
        <Fact label="Victory points" value={String(st.victoryValue)} />
        <Fact label="Income" value={`${money(st.income)}/yr`} />
        <Fact label="Terrain" value={terrainLabel(ruleSet, def.terrain)} />
        <Fact label="Features" value={[def.isPort ? "Port" : null, st.fortified ? "Fortified" : null, st.supplyCenterOf !== null ? "Supply centre" : null].filter(Boolean).join(" · ") || "None"} />
      </div>
      {me !== null && <Actions area={selected} yourTurn={yourTurn} />}
    </aside>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string | undefined }): React.JSX.Element {
  return (
    <div className="fact">
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Actions({ area, yourTurn }: { area: AreaId; yourTurn: boolean }): React.JSX.Element {
  const gs = useGame((s) => s.gameState)!;
  const me = useGame((s) => s.humanPower)!;
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const play = useGame((s) => s.play);
  const beginMove = useGame((s) => s.beginMove);
  const st = getAreaState(gs, area);
  const def = getArea(world, area);
  const myDef = getPowerDef(ruleSet, me);
  const treasury = getPowerState(gs, me).treasury;
  const springOnly = gs.season !== "SPRING" ? "Spring only" : isFoundingTurn(gs) ? "From next spring" : null;
  const notYet = !yourTurn ? "Wait for your turn" : null;
  const min = ruleSet.limits.minGarrison;

  if (st.owner === me) {
    const isSc = st.supplyCenterOf === me;
    const armyStep = ruleSet.costs.troopBuildIncrement;
    const fleetStep = ruleSet.costs.fleetBuildIncrement;
    const armyCost = (armyStep / 10_000) * myDef.armyCostPer10k;
    const fleetCost = (fleetStep / 5) * myDef.navyCostPer5;
    return (
      <div className="actions">
        <div className="actions-title">Orders</div>
        <ActionButton
          icon="⚔"
          title="March"
          sub={st.troops > min ? `Up to ${troops(st.troops - min)} troops to a neighbour` : `Needs more than ${troops(min)} troops`}
          disabled={notYet ?? (st.troops <= min ? "Too few troops" : gs.armyMovesRemaining <= 0 ? "No army moves left" : null)}
          onClick={() => beginMove("army")}
        />
        {def.isPort && (
          <ActionButton
            icon="⚓"
            title="Sail"
            sub={st.fleets > 0 ? `${st.fleets} fleets, each carries ${troops(ruleSet.limits.troopsPerFleet)}` : "No fleets here"}
            disabled={notYet ?? (st.fleets <= 0 ? "No fleets here" : gs.fleetMovesRemaining <= 0 ? "No fleet moves left" : null)}
            onClick={() => beginMove("fleet")}
          />
        )}
        {isSc && (
          <BuyRow
            icon="🎖"
            title="Raise troops"
            unit={armyStep}
            unitLabel={(n) => troops(n)}
            cost={armyCost}
            treasury={treasury}
            disabled={notYet ?? (canBuild(gs) ? null : springOnly)}
            onBuy={(n) => play({ type: "BUILD_ARMY", area, troops: n })}
          />
        )}
        {isSc && def.isPort && (
          <BuyRow
            icon="⛴"
            title="Build fleets"
            unit={fleetStep}
            unitLabel={(n) => `${n} fleets`}
            cost={fleetCost}
            treasury={treasury}
            disabled={notYet ?? (canBuild(gs) ? null : springOnly)}
            onBuy={(n) => play({ type: "BUILD_FLEET", area, fleets: n })}
          />
        )}
        {!isSc && <p className="hint">Troops and fleets can only be raised at your supply centres (★).</p>}
        <ActionButton
          icon="🏰"
          title="Fortify"
          sub={st.fortified ? "Already fortified" : `${money(ruleSet.costs.fortification)} · doubles defence`}
          disabled={notYet ?? (st.fortified ? "Already fortified" : !canBuild(gs) ? springOnly : treasury < ruleSet.costs.fortification ? "Not enough money" : null)}
          onClick={() => play({ type: "FORTIFY", area })}
        />
      </div>
    );
  }

  if (st.owner === null) {
    const spyCost = st.fortified || st.supplyCenterOf !== null ? ruleSet.costs.spyFortified : ruleSet.costs.spyMinor;
    const view = perceive(gs, me, area);
    return (
      <div className="actions">
        <div className="actions-title">Orders</div>
        <p className="hint">March an army from a neighbouring territory to conquer it, or win it over quietly.</p>
        <ActionButton
          icon="🔍"
          title="Spy"
          sub={`${money(spyCost)} · reveals the garrison`}
          disabled={notYet ?? (!canEspionage(gs) ? "Spring only" : treasury < spyCost ? "Not enough money" : null)}
          onClick={() => play({ type: "SPY", area })}
        />
        <ActionButton
          icon="💰"
          title="Bribe officials"
          sub={`${money(ruleSet.subversion.bribeCost)} a bribe · each one sends soldiers home${view.kind !== "unknown" ? ` (~${troops(view.troops)} left when spied)` : ""}`}
          disabled={notYet ?? (!canSubvert(gs) ? "Spring only" : treasury < ruleSet.subversion.bribeCost ? "Not enough money" : null)}
          onClick={() => play({ type: "SUBVERT", area })}
        />
        <LoanRow
          title="Arm them"
          sub="Aid raises their garrison, to block a rival"
          treasury={treasury}
          disabled={notYet ?? (!canDiplomacy(gs) ? springOnly : null)}
          onLoan={(amount) => play({ type: "LOAN_MINOR", area, amount })}
        />
      </div>
    );
  }

  const owner = st.owner;
  const atWar = isAtWar(gs, me, owner);
  const spyCost = st.fortified || st.supplyCenterOf !== null ? ruleSet.costs.spyFortified : ruleSet.costs.spyMinor;
  return (
    <div className="actions">
      <div className="actions-title">Orders</div>
      <p className="hint">
        {atWar ? `You are at war with ${powerName(ruleSet.powers, owner)}.` : `Attacking ${powerName(ruleSet.powers, owner)} starts a war.`}
      </p>
      <ActionButton
        icon="🔍"
        title="Spy"
        sub={`${money(spyCost)} · reveals the garrison`}
        disabled={notYet ?? (!canEspionage(gs) ? "Spring only" : treasury < spyCost ? "Not enough money" : null)}
        onClick={() => play({ type: "SPY", area })}
      />
      <LoanRow
        title={atWar ? "Buy peace" : "Send a loan"}
        sub={atWar ? `Chance of peace grows with the sum; ${money(ruleSet.economy.guaranteedPeaceLoan)} is certain` : "A gift to a rival's treasury"}
        treasury={treasury}
        disabled={notYet ?? (!canDiplomacy(gs) ? springOnly : null)}
        onLoan={(amount) => play({ type: "LOAN_POWER", target: owner, amount })}
      />
    </div>
  );
}

function ActionButton({ icon, title, sub, disabled, onClick }: { icon: string; title: string; sub: string; disabled: string | null; onClick: () => void }): React.JSX.Element {
  return (
    <button className="action" disabled={disabled !== null} onClick={onClick} title={disabled ?? undefined}>
      <span className="action-icon">{icon}</span>
      <span className="action-text">
        <b>{title}</b>
        <small>{disabled ?? sub}</small>
      </span>
    </button>
  );
}

function BuyRow({ icon, title, unit, unitLabel, cost, treasury, disabled, onBuy }: {
  icon: string; title: string; unit: number; unitLabel: (n: number) => string; cost: number; treasury: number; disabled: string | null; onBuy: (n: number) => void;
}): React.JSX.Element {
  const max = Math.floor(treasury / cost);
  const [n, setN] = useState(1);
  useEffect(() => setN((v) => Math.max(1, Math.min(v, max))), [max]);
  const off = disabled ?? (max < 1 ? "Not enough money" : null);
  return (
    <div className={`buy${off ? " is-off" : ""}`}>
      <div className="buy-head">
        <span className="action-icon">{icon}</span>
        <span className="action-text">
          <b>{title}</b>
          <small>{off ?? `${money(cost)} per ${unitLabel(unit)}`}</small>
        </span>
      </div>
      {!off && (
        <div className="buy-controls">
          <input type="range" min={1} max={Math.max(1, max)} value={n} onChange={(e) => setN(Number(e.target.value))} />
          <button className="btn small primary" onClick={() => onBuy(n * unit)}>
            {unitLabel(n * unit)} · {money(n * cost)}
          </button>
        </div>
      )}
    </div>
  );
}

const LOANS = [250_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000];

function LoanRow({ title, sub, treasury, disabled, onLoan }: { title: string; sub: string; treasury: number; disabled: string | null; onLoan: (n: number) => void }): React.JSX.Element {
  const off = disabled ?? (treasury < LOANS[0]! ? "Not enough money" : null);
  return (
    <div className={`buy${off ? " is-off" : ""}`}>
      <div className="buy-head">
        <span className="action-icon">✉</span>
        <span className="action-text">
          <b>{title}</b>
          <small>{off ?? sub}</small>
        </span>
      </div>
      {!off && (
        <div className="chips">
          {LOANS.filter((a) => a <= treasury).map((a) => (
            <button key={a} className="chip" onClick={() => onLoan(a)}>{money(a)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Choosing a destination, then how many to send. */
function MovePanel(): React.JSX.Element | null {
  const move = useGame((s) => s.move)!;
  const gs = useGame((s) => s.gameState)!;
  const world = useGame((s) => s.world);
  const ruleSet = useGame((s) => s.ruleSet);
  const play = useGame((s) => s.play);
  const cancelMove = useGame((s) => s.cancelMove);
  const select = useGame((s) => s.select);
  const from = getAreaState(gs, move.from);
  const min = ruleSet.limits.minGarrison;
  const maxTroops = Math.max(0, from.troops - min);
  const [men, setMen] = useState(maxTroops);
  const [ships, setShips] = useState(from.fleets);
  const fleetCap = ships * ruleSet.limits.troopsPerFleet;
  const seaMen = Math.min(men, fleetCap, maxTroops);

  useEffect(() => {
    setMen(maxTroops);
    setShips(from.fleets);
  }, [move.from, maxTroops, from.fleets]);

  const fromName = getArea(world, move.from).name;
  const to = move.to;
  const toSt = to === null ? null : getAreaState(gs, to);
  const hostile = toSt !== null && toSt.owner !== from.owner;

  return (
    <aside className="area-panel glass move-panel">
      <button className="close" aria-label="Cancel" onClick={cancelMove}>×</button>
      <header className="area-head">
        <div className="area-crest neutral">{move.mode === "army" ? "⚔" : "⚓"}</div>
        <div>
          <h2>{move.mode === "army" ? "March" : "Set sail"}</h2>
          <div className="area-owner">from {fromName}</div>
        </div>
      </header>
      {to === null ? (
        <p className="hint big">
          {move.mode === "army" ? "Click a glowing neighbour to march into it." : "Click any glowing port on the map. Fleets can cross oceans in one season."}
        </p>
      ) : (
        <div className="move-form">
          <div className="move-dest">
            <span>{hostile ? "Attack" : "Reinforce"}</span>
            <b>{getArea(world, to).name}</b>
            {hostile && toSt && <small>{toSt.owner === null ? "Independent" : powerName(ruleSet.powers, toSt.owner)}</small>}
          </div>
          {move.mode === "fleet" && (
            <label className="slider">
              <span>Fleets <b>{ships}</b></span>
              <input type="range" min={1} max={from.fleets} value={ships} onChange={(e) => setShips(Number(e.target.value))} />
            </label>
          )}
          <label className="slider">
            <span>Troops <b>{(move.mode === "army" ? men : seaMen).toLocaleString()}</b>{move.mode === "fleet" && <small> (room for {fleetCap.toLocaleString()})</small>}</span>
            <input
              type="range"
              min={move.mode === "army" ? Math.min(100, maxTroops) : 0}
              max={move.mode === "army" ? maxTroops : Math.min(maxTroops, fleetCap)}
              step={100}
              value={move.mode === "army" ? men : seaMen}
              onChange={(e) => setMen(Number(e.target.value))}
            />
          </label>
          <p className="hint">{troops(min)} must stay behind. Moves resolve together at the end of the season.</p>
          <div className="move-buttons">
            <button className="btn ghost" onClick={cancelMove}>Back</button>
            <button
              className="btn primary"
              disabled={move.mode === "army" ? men < 1 : ships < 1}
              onClick={() => {
                const ok = move.mode === "army"
                  ? play({ type: "MOVE_ARMY", from: move.from, to, troops: Math.min(men, maxTroops) })
                  : play({ type: "MOVE_FLEET", from: move.from, to, fleets: ships, troops: seaMen });
                if (ok) select(move.from);
              }}
            >
              {hostile ? "Attack!" : "Send"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
