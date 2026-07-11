import type React from "react";
import { getPowerState } from "../../engine/state/helpers.ts";
import { useGame } from "../store.ts";

export function Hud(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const ruleSet = useGame((s) => s.ruleSet);
  const humanPower = useGame((s) => s.humanPower);
  const endTurn = useGame((s) => s.endTurn);
  const newGame = useGame((s) => s.newGame);
  const setInfoOpen = useGame((s) => s.setInfoOpen);
  const setSaveLoadOpen = useGame((s) => s.setSaveLoadOpen);

  if (gameState === null || humanPower === null) return null;

  const active = gameState.activePower;
  const activeDef = active !== null ? ruleSet.powers.find((p) => p.id === active) : null;
  const human = getPowerState(gameState, humanPower);
  const humanDef = ruleSet.powers.find((p) => p.id === humanPower)!;
  const inCombat = gameState.stage === "COMBAT";
  const isHumanTurn = active === humanPower && !inCombat;

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
          {inCombat
            ? "Resolving Combat"
            : isHumanTurn
              ? "Your turn"
              : `${activeDef?.name ?? ""} is acting...`}
        </span>
        {isHumanTurn && (
          <span className="hud-moves">
            Moves: {gameState.armyMovesRemaining} army / {gameState.fleetMovesRemaining} fleet
          </span>
        )}
      </div>

      <div className="hud-right">
        <span className="hud-you" style={{ color: humanDef.color }}>
          {humanDef.name}
        </span>
        <span className="hud-stat">Treasury ${(human.treasury / 1_000_000).toFixed(1)}M</span>
        <span className="hud-stat">Score {Math.max(0, human.score)}</span>
        <button
          className="btn ghost"
          title="How combat works"
          onClick={() => setInfoOpen(true)}
        >
          Combat Info
        </button>
        <button className="btn ghost" title="Save or load a game" onClick={() => setSaveLoadOpen(true)}>
          Save / Load
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (window.confirm("Abandon this game and start a new one?")) newGame();
          }}
        >
          New Game
        </button>
        <button className="btn primary" disabled={!isHumanTurn} onClick={endTurn}>
          End Turn
        </button>
      </div>
    </header>
  );
}
