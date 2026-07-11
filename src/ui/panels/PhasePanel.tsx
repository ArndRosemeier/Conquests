import { useEffect, useState } from "react";
import type React from "react";
import { getPowerDef } from "../../engine/ruleset/classic.ts";
import {
  buildableAreas,
  fleetBuildableAreas,
  fortifiableAreas,
} from "../../engine/state/legalActions.ts";
import { getAreaState, getPowerState } from "../../engine/state/helpers.ts";
import type { AreaState, GameState } from "../../engine/state/gameState.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import { getArea } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import { useGame } from "../store.ts";

function money(n: number): string {
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

function areaName(world: WorldDefinition, id: AreaId): string {
  return getArea(world, id).name;
}

interface Ctx {
  state: GameState;
  ruleSet: RuleSet;
  world: WorldDefinition;
  human: PowerId;
}

export function PhasePanel(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const humanPower = useGame((s) => s.humanPower);

  if (gameState === null || humanPower === null) return null;

  if (gameState.winner !== null) {
    const w = ruleSet.powers.find((p) => p.id === gameState.winner);
    return (
      <div className="panel">
        <h2>Victory</h2>
        <p style={{ color: w?.color }}>
          <strong>{w?.name}</strong> has won the game!
        </p>
      </div>
    );
  }

  if (gameState.activePower !== humanPower || gameState.phase === "COMBAT") {
    const active = ruleSet.powers.find((p) => p.id === gameState.activePower);
    return (
      <div className="panel">
        <h2>Please wait</h2>
        <p className="muted">
          {gameState.phase === "COMBAT"
            ? "Resolving combat..."
            : `${active?.name ?? "A rival"} is taking their turn...`}
        </p>
      </div>
    );
  }

  const ctx: Ctx = { state: gameState, ruleSet, world, human: humanPower };

  switch (gameState.phase) {
    case "ARMY_BUILD":
      return <BuildArmyPanel ctx={ctx} />;
    case "FLEET_BUILD":
      return <BuildFleetPanel ctx={ctx} />;
    case "FORTIFY":
      return <FortifyPanel ctx={ctx} />;
    case "ECONOMIC_AID":
      return <AidPanel ctx={ctx} />;
    case "ESPIONAGE":
      return <EspionagePanel ctx={ctx} />;
    case "SUBVERSION":
      return <SubversionPanel ctx={ctx} />;
    case "ARMY_MOVE":
      return <ArmyMovePanel ctx={ctx} />;
    case "FLEET_MOVE":
      return <FleetMovePanel ctx={ctx} />;
    default:
      return null;
  }
}

function AreaButtons({
  areas,
  world,
  onPick,
  selected,
}: {
  areas: readonly AreaState[];
  world: WorldDefinition;
  onPick: (id: AreaId) => void;
  selected: AreaId | null;
}): React.JSX.Element {
  return (
    <div className="chip-row">
      {areas.map((a) => (
        <button
          key={String(a.id)}
          className={`chip ${selected === a.id ? "active" : ""}`}
          onClick={() => onPick(a.id)}
        >
          {areaName(world, a.id)} ({Math.round(a.troops / 1000)}k)
        </button>
      ))}
      {areas.length === 0 && <span className="muted">None available.</span>}
    </div>
  );
}

function BuildArmyPanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world, human } = ctx;
  const setSelectedArea = useGame((s) => s.setSelectedArea);
  const selectedArea = useGame((s) => s.selectedArea);
  const playAction = useGame((s) => s.playAction);
  const centers = buildableAreas(state, human);
  const def = getPowerDef(ruleSet, human);
  const treasury = getPowerState(state, human).treasury;
  const [amount, setAmount] = useState(10_000);

  const selected = centers.find((c) => c.id === selectedArea) ?? centers[0];
  const cost = (amount / 10_000) * def.armyCostPer10k;
  const affordable = cost <= treasury;

  return (
    <div className="panel">
      <h2>Army Build</h2>
      <p className="muted">Build troops in your supply centers. Cost: {money(def.armyCostPer10k)} per 10,000.</p>
      <AreaButtons areas={centers} world={world} onPick={setSelectedArea} selected={selected?.id ?? null} />
      {selected && (
        <div className="form">
          <label>
            Troops in {areaName(world, selected.id)}
            <input
              type="range"
              min={10_000}
              max={500_000}
              step={10_000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <div className="form-row">
            <span>{amount.toLocaleString()} troops</span>
            <span className={affordable ? "" : "danger"}>{money(cost)}</span>
          </div>
          <button
            className="btn"
            disabled={!affordable}
            onClick={() => playAction({ type: "BUILD_ARMY", area: selected.id, troops: amount })}
          >
            Build
          </button>
        </div>
      )}
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function BuildFleetPanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world, human } = ctx;
  const setSelectedArea = useGame((s) => s.setSelectedArea);
  const selectedArea = useGame((s) => s.selectedArea);
  const playAction = useGame((s) => s.playAction);
  const ports = fleetBuildableAreas(state, world, human);
  const def = getPowerDef(ruleSet, human);
  const treasury = getPowerState(state, human).treasury;
  const [amount, setAmount] = useState(5);

  const selected = ports.find((c) => c.id === selectedArea) ?? ports[0];
  const cost = (amount / 5) * def.navyCostPer5;
  const affordable = cost <= treasury;

  return (
    <div className="panel">
      <h2>Fleet Build</h2>
      <p className="muted">Build fleets in supply-center ports. Cost: {money(def.navyCostPer5)} per 5 fleets.</p>
      <AreaButtons areas={ports} world={world} onPick={setSelectedArea} selected={selected?.id ?? null} />
      {selected && (
        <div className="form">
          <label>
            Fleets in {areaName(world, selected.id)}
            <input
              type="range"
              min={5}
              max={200}
              step={5}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <div className="form-row">
            <span>{amount} fleets</span>
            <span className={affordable ? "" : "danger"}>{money(cost)}</span>
          </div>
          <button
            className="btn"
            disabled={!affordable}
            onClick={() => playAction({ type: "BUILD_FLEET", area: selected.id, fleets: amount })}
          >
            Build
          </button>
        </div>
      )}
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function FortifyPanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world, human } = ctx;
  const playAction = useGame((s) => s.playAction);
  const areas = fortifiableAreas(state, human);
  const treasury = getPowerState(state, human).treasury;
  const cost = ruleSet.costs.fortification;

  return (
    <div className="panel">
      <h2>Fortification</h2>
      <p className="muted">Doubles an area's defense. {money(cost)} each.</p>
      <div className="list">
        {areas.map((a) => (
          <div key={String(a.id)} className="list-row">
            <span>
              {areaName(world, a.id)} ({Math.round(a.troops / 1000)}k)
            </span>
            <button
              className="btn small"
              disabled={cost > treasury}
              onClick={() => playAction({ type: "FORTIFY", area: a.id })}
            >
              Fortify
            </button>
          </div>
        ))}
        {areas.length === 0 && <span className="muted">Everything is already fortified.</span>}
      </div>
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function AidPanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world, human } = ctx;
  const playAction = useGame((s) => s.playAction);
  const selectedArea = useGame((s) => s.selectedArea);
  const treasury = getPowerState(state, human).treasury;
  const otherPowers = ruleSet.playOrder.filter((p) => p !== human);
  const [target, setTarget] = useState<PowerId>(otherPowers[0]!);
  const [millions, setMillions] = useState(1);
  const amount = millions * 1_000_000;
  const atWar = (state.war[String(human)] ?? []).includes(target);

  const selMinor =
    selectedArea !== null ? getAreaState(state, selectedArea) : undefined;
  const [minorM, setMinorM] = useState(1);

  return (
    <div className="panel">
      <h2>Economic Aid</h2>
      <p className="muted">Loan money to powers (to end wars) or to neutral minors (builds their army).</p>

      <div className="form">
        <label>
          To power
          <select value={String(target)} onChange={(e) => setTarget(e.target.value as PowerId)}>
            {otherPowers.map((p) => (
              <option key={String(p)} value={String(p)}>
                {ruleSet.powers.find((x) => x.id === p)?.name}
                {(state.war[String(human)] ?? []).includes(p) ? " (at war)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount: {money(amount)}
          <input type="range" min={1} max={Math.max(1, Math.floor(treasury / 1_000_000))} step={1} value={millions} onChange={(e) => setMillions(Number(e.target.value))} />
        </label>
        {atWar && <p className="muted">A large loan may end your war ({money(ruleSet.economy.guaranteedPeaceLoan)} guarantees it).</p>}
        <button className="btn" disabled={amount > treasury} onClick={() => playAction({ type: "LOAN_POWER", target, amount })}>
          Send Loan
        </button>
      </div>

      {selMinor && selMinor.owner === null && (
        <div className="form">
          <h3>{areaName(world, selMinor.id)} (neutral)</h3>
          <label>
            Fund: {money(minorM * 1_000_000)}
            <input type="range" min={1} max={Math.max(1, Math.floor(treasury / 1_000_000))} step={1} value={minorM} onChange={(e) => setMinorM(Number(e.target.value))} />
          </label>
          <button className="btn" disabled={minorM * 1_000_000 > treasury} onClick={() => playAction({ type: "LOAN_MINOR", area: selMinor.id, amount: minorM * 1_000_000 })}>
            Fund Minor
          </button>
        </div>
      )}
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function EspionagePanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world, human } = ctx;
  const playAction = useGame((s) => s.playAction);
  const selectedArea = useGame((s) => s.selectedArea);
  const log = useGame((s) => s.log);
  const treasury = getPowerState(state, human).treasury;

  const sel = selectedArea !== null ? getAreaState(state, selectedArea) : undefined;
  const cost =
    sel && (sel.fortified || sel.supplyCenterOf !== null)
      ? ruleSet.costs.spyFortified
      : ruleSet.costs.spyMinor;

  const spyResults = log.filter((e) => e.type === "SPY_RESULT" && e.by === human).slice(0, 5);

  return (
    <div className="panel">
      <h2>Espionage</h2>
      <p className="muted">Click any area on the map to scout its garrison and income.</p>
      {sel && (
        <div className="form">
          <h3>{areaName(world, sel.id)}</h3>
          <button className="btn" disabled={cost > treasury} onClick={() => playAction({ type: "SPY", area: sel.id })}>
            Spy ({money(cost)})
          </button>
        </div>
      )}
      {spyResults.length > 0 && (
        <div className="list">
          <h3>Reports</h3>
          {spyResults.map((e, i) =>
            e.type === "SPY_RESULT" ? (
              <div key={i} className="list-row">
                <span>{areaName(world, e.area)}</span>
                <span className="muted">
                  ~{Math.round(e.troops / 1000)}k, {money(e.income)}
                </span>
              </div>
            ) : null,
          )}
        </div>
      )}
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function SubversionPanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, world, human } = ctx;
  const playAction = useGame((s) => s.playAction);
  const selectedArea = useGame((s) => s.selectedArea);
  const treasury = getPowerState(state, human).treasury;
  const [millions, setMillions] = useState(1);
  const amount = millions * 1_000_000;

  const sel = selectedArea !== null ? getAreaState(state, selectedArea) : undefined;
  const isNeutral = sel?.owner === null;

  return (
    <div className="panel">
      <h2>Subversion</h2>
      <p className="muted">Bribe a neutral minor's army. Spend enough for a coup and it joins you (no VP).</p>
      {sel && isNeutral ? (
        <div className="form">
          <h3>{areaName(world, sel.id)} (~{Math.round(sel.troops / 1000)}k troops)</h3>
          <label>
            Bribe: {money(amount)}
            <input type="range" min={1} max={Math.max(1, Math.floor(treasury / 1_000_000))} step={1} value={millions} onChange={(e) => setMillions(Number(e.target.value))} />
          </label>
          <button className="btn" disabled={amount > treasury} onClick={() => playAction({ type: "SUBVERT", area: sel.id, amount })}>
            Bribe
          </button>
        </div>
      ) : (
        <p className="muted">Select a neutral minor on the map.</p>
      )}
      <TreasuryLine treasury={treasury} />
    </div>
  );
}

function ArmyMovePanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world } = ctx;
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);
  const playAction = useGame((s) => s.playAction);
  const clearMoveSelection = useGame((s) => s.clearMoveSelection);
  const min = ruleSet.limits.minGarrison;

  const from = moveFrom !== null ? getAreaState(state, moveFrom) : undefined;
  const maxTroops = from ? from.troops - min : 0;
  const [troops, setTroops] = useState(0);
  useEffect(() => {
    setTroops(maxTroops);
  }, [maxTroops, moveFrom, moveTo]);

  return (
    <div className="panel">
      <h2>Army Movement</h2>
      <p className="muted">Moves left: {state.movesRemaining}. Click a friendly area, then an adjacent target.</p>
      {from && (
        <p>
          From <strong>{areaName(world, from.id)}</strong>{" "}
          {moveTo !== null && (
            <>
              to <strong>{areaName(world, moveTo)}</strong>
            </>
          )}
        </p>
      )}
      {moveFrom !== null && moveTo !== null && (
        <div className="form">
          <label>
            Troops: {troops.toLocaleString()}
            <input type="range" min={0} max={maxTroops} step={1000} value={troops} onChange={(e) => setTroops(Number(e.target.value))} />
          </label>
          <div className="form-row">
            <button className="btn" disabled={troops <= 0} onClick={() => playAction({ type: "MOVE_ARMY", from: moveFrom, to: moveTo, troops })}>
              Move / Attack
            </button>
            <button className="btn ghost" onClick={clearMoveSelection}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FleetMovePanel({ ctx }: { ctx: Ctx }): React.JSX.Element {
  const { state, ruleSet, world } = ctx;
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);
  const playAction = useGame((s) => s.playAction);
  const clearMoveSelection = useGame((s) => s.clearMoveSelection);
  const min = ruleSet.limits.minGarrison;

  const from = moveFrom !== null ? getAreaState(state, moveFrom) : undefined;
  const [fleets, setFleets] = useState(0);
  const [troops, setTroops] = useState(0);
  const maxFleets = from ? from.fleets : 0;
  const maxTroops = from ? Math.min(from.troops - min, fleets * ruleSet.limits.troopsPerFleet) : 0;

  useEffect(() => {
    setFleets(maxFleets);
    setTroops(0);
  }, [maxFleets, moveFrom, moveTo]);

  return (
    <div className="panel">
      <h2>Fleet Movement</h2>
      <p className="muted">Moves left: {state.movesRemaining}. Click a friendly port with fleets, then any port.</p>
      {from && (
        <p>
          From <strong>{areaName(world, from.id)}</strong>{" "}
          {moveTo !== null && (
            <>
              to <strong>{areaName(world, moveTo)}</strong>
            </>
          )}
        </p>
      )}
      {moveFrom !== null && moveTo !== null && (
        <div className="form">
          <label>
            Fleets: {fleets}
            <input type="range" min={0} max={maxFleets} step={1} value={fleets} onChange={(e) => setFleets(Number(e.target.value))} />
          </label>
          <label>
            Troops carried: {troops.toLocaleString()} (max {Math.max(0, maxTroops).toLocaleString()})
            <input type="range" min={0} max={Math.max(0, maxTroops)} step={1000} value={Math.min(troops, Math.max(0, maxTroops))} onChange={(e) => setTroops(Number(e.target.value))} />
          </label>
          <div className="form-row">
            <button className="btn" disabled={fleets <= 0} onClick={() => playAction({ type: "MOVE_FLEET", from: moveFrom, to: moveTo, fleets, troops: Math.min(troops, Math.max(0, maxTroops)) })}>
              Sail
            </button>
            <button className="btn ghost" onClick={clearMoveSelection}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TreasuryLine({ treasury }: { treasury: number }): React.JSX.Element {
  return <div className="treasury">Treasury: {money(treasury)}</div>;
}
