import { useEffect, useState } from "react";
import type React from "react";
import { getPowerDef } from "../../engine/ruleset/classic.ts";
import { availableAreaActions, canBuild } from "../../engine/state/legalActions.ts";
import type { AreaActionKind } from "../../engine/state/legalActions.ts";
import { isFoundingTurn } from "../../engine/state/phases.ts";
import { getAreaState, getPowerState } from "../../engine/state/helpers.ts";
import { perceive } from "../../engine/state/knowledge.ts";
import type { AreaId } from "../../engine/types.ts";
import { getArea } from "../../engine/world/classic.ts";
import { intelAgeLabel, terrainLabel } from "../labels.ts";
import { useGame } from "../store.ts";

function money(n: number): string {
  if (n < 1_000_000) return `$${Math.round(n / 1000)}k`;
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

const KIND_LABEL: Record<AreaActionKind, string> = {
  BUILD_ARMY: "Build army",
  BUILD_FLEET: "Build fleet",
  FORTIFY: "Fortify",
  MOVE_ARMY: "Move / attack (army)",
  MOVE_FLEET: "Sail fleet",
  SPY: "Spy",
  SUBVERT: "Subvert",
  LOAN_MINOR: "Fund minor",
  LOAN_POWER: "Send loan",
};

/** Dispatches between the area action menu and the movement-confirm form. */
export function AreaActions(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const humanPower = useGame((s) => s.humanPower);
  const popup = useGame((s) => s.popup);
  const moveMode = useGame((s) => s.moveMode);
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);

  if (gameState === null || humanPower === null) return null;
  if (gameState.stage !== "PLAYER" || gameState.activePower !== humanPower) return null;

  if (moveMode !== null && moveFrom !== null && moveTo !== null && popup !== null) {
    return <MovePopup key={`move-${String(moveFrom)}-${String(moveTo)}`} x={popup.x} y={popup.y} />;
  }
  if (popup !== null && moveMode === null) {
    return <ActionPopup key={`act-${String(popup.area)}`} area={popup.area} x={popup.x} y={popup.y} />;
  }
  return null;
}

function PopupFrame({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  // Clamp so the popup stays on screen.
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 220);
  // Escape closes the popup. We intentionally avoid a full-screen overlay so a
  // click on another country selects it directly instead of being swallowed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="area-popup" style={{ left, top }}>
      {children}
    </div>
  );
}

function ActionPopup({
  area,
  x,
  y,
}: {
  area: AreaId;
  x: number;
  y: number;
}): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState)!;
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const humanPower = useGame((s) => s.humanPower)!;
  const playAction = useGame((s) => s.playAction);
  const beginMove = useGame((s) => s.beginMove);
  const closePopup = useGame((s) => s.closePopup);

  const [open, setOpen] = useState<AreaActionKind | null>(null);

  const a = getAreaState(gameState, area);
  const def = getArea(world, area);
  const kinds = availableAreaActions(gameState, ruleSet, world, area, humanPower);
  const view = perceive(gameState, humanPower, area);
  const treasury = getPowerState(gameState, humanPower).treasury;
  const bribeCost = ruleSet.subversion.bribeCost;

  return (
    <PopupFrame x={x} y={y} onClose={closePopup}>
      <div className="popup-head">
        <span className="popup-name">{def.name}</span>
        <button className="popup-x" onClick={closePopup} aria-label="Close">
          {"\u00d7"}
        </button>
      </div>
      <div className="popup-sub muted">
        {a.owner === null
          ? "Neutral"
          : a.owner === humanPower
            ? "Your territory"
            : ruleSet.powers.find((p) => p.id === a.owner)?.name}
        {view.kind === "own"
          ? ` \u00b7 ${Math.round(view.troops / 1000)}k`
          : view.kind === "report"
            ? ` \u00b7 ~${Math.round(view.troops / 1000)}k (spied ${intelAgeLabel(view.ageSeasons)})`
            : " \u00b7 troops unknown"}
      </div>
      <div className="popup-sub muted">
        {terrainLabel(ruleSet, def.terrain)}
        {a.fortified ? " \u00b7 Fortified (\u00d72)" : ""}
        {def.isPort ? " \u00b7 Port" : ""}
      </div>

      {kinds.length === 0 && (
        <p className="muted popup-empty">No actions available here this turn.</p>
      )}

      {a.owner === humanPower && a.supplyCenterOf === humanPower && !canBuild(gameState) && (
        <p className="muted popup-empty">
          {isFoundingTurn(gameState)
            ? "No construction on the opening turn \u2014 building opens next spring."
            : "Building & fortifying happen in spring only."}
        </p>
      )}
      {a.owner === humanPower && a.supplyCenterOf !== humanPower && canBuild(gameState) && (
        <p className="muted popup-empty">Only your supply centers can build units.</p>
      )}

      <div className="popup-actions">
        {kinds.map((kind) => (
          <div key={kind}>
            <button
              className={`popup-btn ${open === kind ? "active" : ""}`}
              disabled={kind === "SUBVERT" && bribeCost > treasury}
              onClick={() => {
                if (kind === "MOVE_ARMY") return beginMove("army");
                if (kind === "MOVE_FLEET") return beginMove("fleet");
                if (kind === "SPY") return playAction({ type: "SPY", area });
                if (kind === "FORTIFY") return playAction({ type: "FORTIFY", area });
                // A bribe is a fixed payment applied immediately; keep the popup
                // open so the player can keep bribing until the country flips.
                if (kind === "SUBVERT") return playAction({ type: "SUBVERT", area }, true);
                setOpen(open === kind ? null : kind);
              }}
            >
              {KIND_LABEL[kind]}
              {kind === "SPY" && (
                <span className="popup-cost">
                  {money(
                    a.fortified || a.supplyCenterOf !== null
                      ? ruleSet.costs.spyFortified
                      : ruleSet.costs.spyMinor,
                  )}
                </span>
              )}
              {kind === "FORTIFY" && (
                <span className="popup-cost">{money(ruleSet.costs.fortification)}</span>
              )}
              {kind === "SUBVERT" && <span className="popup-cost">{money(bribeCost)}</span>}
            </button>
            {open === kind && <AmountForm kind={kind} area={area} />}
          </div>
        ))}
      </div>

      {kinds.includes("SUBVERT") && (
        <p className="muted popup-empty">
          Each bribe chips away at the garrison. Keep paying until it defects {"\u2014"} money
          spent is gone even if you stop early.
        </p>
      )}
    </PopupFrame>
  );
}

/** Inline slider form for the amount-based actions (build/subvert/loan). */
function AmountForm({
  kind,
  area,
}: {
  kind: AreaActionKind;
  area: AreaId;
}): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState)!;
  const ruleSet = useGame((s) => s.ruleSet);
  const humanPower = useGame((s) => s.humanPower)!;
  const playAction = useGame((s) => s.playAction);

  const treasury = getPowerState(gameState, humanPower).treasury;
  const powerDef = getPowerDef(ruleSet, humanPower);

  const [troops, setTroops] = useState(10_000);
  const [fleets, setFleets] = useState(5);
  const [amount, setAmount] = useState(100_000);

  if (kind === "BUILD_ARMY") {
    const step = 10_000;
    // The only cap is affordability: let the player sink everything into troops.
    const max = Math.floor(treasury / powerDef.armyCostPer10k) * step;
    if (max < step) {
      return (
        <div className="popup-form">
          <p className="muted popup-empty">Not enough treasury to build troops here.</p>
        </div>
      );
    }
    const value = Math.min(Math.max(troops, step), max);
    const cost = (value / step) * powerDef.armyCostPer10k;
    return (
      <div className="popup-form">
        <label>
          {value.toLocaleString()} troops
          <input type="range" min={step} max={max} step={step} value={value} onChange={(e) => setTroops(Number(e.target.value))} />
        </label>
        <ConfirmRow
          cost={cost}
          treasury={treasury}
          onConfirm={() => playAction({ type: "BUILD_ARMY", area, troops: value })}
        />
      </div>
    );
  }

  if (kind === "BUILD_FLEET") {
    const step = 5;
    const max = Math.floor(treasury / powerDef.navyCostPer5) * step;
    if (max < step) {
      return (
        <div className="popup-form">
          <p className="muted popup-empty">Not enough treasury to build fleets here.</p>
        </div>
      );
    }
    const value = Math.min(Math.max(fleets, step), max);
    const cost = (value / step) * powerDef.navyCostPer5;
    return (
      <div className="popup-form">
        <label>
          {value} fleets
          <input type="range" min={step} max={max} step={step} value={value} onChange={(e) => setFleets(Number(e.target.value))} />
        </label>
        <ConfirmRow
          cost={cost}
          treasury={treasury}
          onConfirm={() => playAction({ type: "BUILD_FLEET", area, fleets: value })}
        />
      </div>
    );
  }

  if (kind === "LOAN_MINOR" || kind === "LOAN_POWER") {
    const step = 1_000_000;
    const max = Math.max(step, Math.floor(treasury / step) * step);
    const value = Math.min(Math.max(amount, step), max);
    const onConfirm = (): void => {
      if (kind === "LOAN_MINOR") playAction({ type: "LOAN_MINOR", area, amount: value });
      else {
        const owner = getAreaState(gameState, area).owner;
        if (owner !== null) playAction({ type: "LOAN_POWER", target: owner, amount: value });
      }
    };
    return (
      <div className="popup-form">
        <label>
          {money(value)}
          <input type="range" min={step} max={max} step={step} value={value} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <ConfirmRow cost={value} treasury={treasury} onConfirm={onConfirm} />
      </div>
    );
  }

  return null;
}

function ConfirmRow({
  cost,
  treasury,
  onConfirm,
}: {
  cost: number;
  treasury: number;
  onConfirm: () => void;
}): React.JSX.Element {
  const affordable = cost <= treasury;
  return (
    <div className="popup-confirm">
      <span className={affordable ? "muted" : "danger"}>{money(cost)}</span>
      <button className="btn small" disabled={!affordable} onClick={onConfirm}>
        Confirm
      </button>
    </div>
  );
}

/** Troop/fleet slider shown once a movement destination has been chosen. */
function MovePopup({ x, y }: { x: number; y: number }): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState)!;
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const moveMode = useGame((s) => s.moveMode);
  const moveFrom = useGame((s) => s.moveFrom);
  const moveTo = useGame((s) => s.moveTo);
  const playAction = useGame((s) => s.playAction);
  const cancelMove = useGame((s) => s.cancelMove);

  const min = ruleSet.limits.minGarrison;
  const from = moveFrom !== null ? getAreaState(gameState, moveFrom) : undefined;

  const [troops, setTroops] = useState(0);
  const [fleets, setFleets] = useState(0);
  const maxTroopsArmy = from ? from.troops - min : 0;
  const maxFleets = from ? from.fleets : 0;
  const maxTroopsSea = from ? Math.min(from.troops - min, fleets * ruleSet.limits.troopsPerFleet) : 0;

  useEffect(() => {
    if (moveMode === "army") setTroops(Math.max(0, maxTroopsArmy));
    else {
      setFleets(maxFleets);
      setTroops(0);
    }
  }, [moveMode, maxTroopsArmy, maxFleets]);

  if (from === undefined || moveFrom === null || moveTo === null) return null;

  const fromName = getArea(world, moveFrom).name;
  const toName = getArea(world, moveTo).name;

  return (
    <PopupFrame x={x} y={y} onClose={cancelMove}>
      <div className="popup-head">
        <span className="popup-name">
          {fromName} {"\u2192"} {toName}
        </span>
        <button className="popup-x" onClick={cancelMove} aria-label="Cancel">
          {"\u00d7"}
        </button>
      </div>

      {moveMode === "army" ? (
        <div className="popup-form">
          <label>
            {troops.toLocaleString()} troops
            <input type="range" min={0} max={Math.max(0, maxTroopsArmy)} step={1000} value={troops} onChange={(e) => setTroops(Number(e.target.value))} />
          </label>
          <div className="popup-confirm">
            <button className="btn small ghost" onClick={cancelMove}>Cancel</button>
            <button className="btn small" disabled={troops <= 0} onClick={() => playAction({ type: "MOVE_ARMY", from: moveFrom, to: moveTo, troops })}>
              Move
            </button>
          </div>
        </div>
      ) : (
        <div className="popup-form">
          <label>
            {fleets} fleets
            <input type="range" min={0} max={maxFleets} step={1} value={fleets} onChange={(e) => setFleets(Number(e.target.value))} />
          </label>
          <label>
            {troops.toLocaleString()} troops carried (max {Math.max(0, maxTroopsSea).toLocaleString()})
            <input type="range" min={0} max={Math.max(0, maxTroopsSea)} step={1000} value={Math.min(troops, Math.max(0, maxTroopsSea))} onChange={(e) => setTroops(Number(e.target.value))} />
          </label>
          <div className="popup-confirm">
            <button className="btn small ghost" onClick={cancelMove}>Cancel</button>
            <button className="btn small" disabled={fleets <= 0} onClick={() => playAction({ type: "MOVE_FLEET", from: moveFrom, to: moveTo, fleets, troops: Math.min(troops, Math.max(0, maxTroopsSea)) })}>
              Sail
            </button>
          </div>
        </div>
      )}
    </PopupFrame>
  );
}
