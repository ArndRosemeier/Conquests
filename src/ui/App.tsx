import type React from "react";
import { MapView } from "./map/MapView.tsx";
import { AreaActions } from "./panels/AreaActions.tsx";
import { CombatInfo } from "./panels/CombatInfo.tsx";
import { Hud } from "./panels/Hud.tsx";
import { SaveLoad } from "./panels/SaveLoad.tsx";
import { Sidebar } from "./panels/Sidebar.tsx";
import { SetupScreen } from "./SetupScreen.tsx";
import { useGame } from "./store.ts";

function VictoryBanner(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const ruleSet = useGame((s) => s.ruleSet);
  const newGame = useGame((s) => s.newGame);
  if (gameState === null || gameState.winner === null) return null;
  const w = ruleSet.powers.find((p) => p.id === gameState.winner);
  return (
    <div className="victory-banner">
      <div className="victory-card">
        <h2>Victory</h2>
        <p style={{ color: w?.color }}>
          <strong>{w?.name}</strong> has won the game!
        </p>
        <button className="btn primary" onClick={newGame}>
          New Game
        </button>
      </div>
    </div>
  );
}

export function App(): React.JSX.Element {
  const screen = useGame((s) => s.screen);

  if (screen === "setup") {
    return (
      <>
        <SetupScreen />
        <SaveLoad />
      </>
    );
  }

  return (
    <div className="game">
      <Hud />
      <div className="game-body">
        <MapView />
        <Sidebar />
      </div>
      <AreaActions />
      <CombatInfo />
      <SaveLoad />
      <VictoryBanner />
    </div>
  );
}
