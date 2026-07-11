import type React from "react";
import { getPowerState } from "../../engine/state/helpers.ts";
import { useGame } from "../store.ts";

const PHASE_LABEL: Record<string, string> = {
  ARMY_BUILD: "Army Build",
  FLEET_BUILD: "Fleet Build",
  FORTIFY: "Fortification",
  ECONOMIC_AID: "Economic Aid",
  ESPIONAGE: "Espionage",
  SUBVERSION: "Subversion",
  ARMY_MOVE: "Army Movement",
  FLEET_MOVE: "Fleet Movement",
  COMBAT: "Combat",
};

export function Hud(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const ruleSet = useGame((s) => s.ruleSet);
  const humanPower = useGame((s) => s.humanPower);
  const endPhase = useGame((s) => s.endPhase);

  if (gameState === null || humanPower === null) return null;

  const active = gameState.activePower;
  const activeDef = active !== null ? ruleSet.powers.find((p) => p.id === active) : null;
  const human = getPowerState(gameState, humanPower);
  const humanDef = ruleSet.powers.find((p) => p.id === humanPower)!;
  const isHumanTurn = active === humanPower && gameState.phase !== "COMBAT";
  const isMove = gameState.phase === "ARMY_MOVE" || gameState.phase === "FLEET_MOVE";

  return (
    <header className="hud">
      <div className="hud-left">
        <span className="hud-title">Colonial Conquest</span>
        <span className="hud-date">
          {gameState.season} {gameState.year}
        </span>
      </div>

      <div className="hud-center">
        <span className="hud-turn" style={{ borderColor: activeDef?.color }}>
          <span className="dot" style={{ background: activeDef?.color }} />
          {gameState.phase === "COMBAT"
            ? "Resolving Combat"
            : `${activeDef?.name ?? ""} - ${PHASE_LABEL[gameState.phase] ?? gameState.phase}`}
        </span>
        {isMove && isHumanTurn && (
          <span className="hud-moves">Moves left: {gameState.movesRemaining}</span>
        )}
      </div>

      <div className="hud-right">
        <span className="hud-you" style={{ color: humanDef.color }}>
          {humanDef.name}
        </span>
        <span className="hud-stat">Treasury ${(human.treasury / 1_000_000).toFixed(1)}M</span>
        <span className="hud-stat">Score {Math.max(0, human.score)}</span>
        <button className="btn primary" disabled={!isHumanTurn} onClick={endPhase}>
          {gameState.phase === "SUBVERSION" || gameState.phase === "FLEET_MOVE"
            ? "End Turn"
            : "Next Phase"}
        </button>
      </div>
    </header>
  );
}
