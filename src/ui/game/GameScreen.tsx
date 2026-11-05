import { useEffect } from "react";
import type React from "react";
import { MapCanvas } from "../map/MapCanvas.tsx";
import { useGame } from "../store.ts";
import { AreaPanel } from "./AreaPanel.tsx";
import { Chronicle, SeasonBanner, Standings, Toasts, TopBar, TurnDock } from "./Hud.tsx";
import { EndScreen, GameMenu, Guide, Herald, Settings } from "./Overlays.tsx";
import { SaveLoad } from "./SaveLoad.tsx";

export function GameScreen(): React.JSX.Element {
  const cancelMove = useGame((s) => s.cancelMove);
  const select = useGame((s) => s.select);
  const setPanel = useGame((s) => s.setPanel);
  const endTurn = useGame((s) => s.endTurn);
  const undo = useGame((s) => s.undo);

  // Keyboard: Esc backs out, Enter ends the turn, Ctrl+Z takes back an order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useGame.getState();
      if (st.panel !== "none" || st.herald !== null) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        if (st.move) cancelMove();
        else if (st.selected !== null) select(null);
        else setPanel("menu");
      } else if (e.key === "Enter" && st.gameState?.activePower === st.humanPower && st.gameState?.stage === "PLAYER") {
        endTurn();
      } else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) {
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelMove, select, setPanel, endTurn, undo]);

  return (
    <div className="game">
      <MapCanvas />
      <TopBar />
      <Standings />
      <AreaPanel />
      <TurnDock />
      <Chronicle />
      <Toasts />
      <SeasonBanner />
      <Herald />
      <EndScreen />
      <GameMenu />
      <Settings />
      <Guide />
      <SaveLoad />
    </div>
  );
}
