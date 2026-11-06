import { useEffect } from "react";
import type React from "react";
import { MapCanvas } from "../map/MapCanvas.tsx";
import { useGame } from "../store.ts";
import { AreaPanel } from "./AreaPanel.tsx";
import { DiplomacyPanel, Inbox } from "./Diplomacy.tsx";
import { Chronicle, SeasonBanner, Standings, Toasts, TopBar, TurnDock } from "./Hud.tsx";
import { EndScreen, GameMenu, Guide, Herald, Settings, WhatsNew } from "./Overlays.tsx";
import { SaveLoad } from "./SaveLoad.tsx";

export function GameScreen(): React.JSX.Element {
  const cancelMove = useGame((s) => s.cancelMove);
  const select = useGame((s) => s.select);
  const setPanel = useGame((s) => s.setPanel);
  const endTurn = useGame((s) => s.endTurn);
  const undo = useGame((s) => s.undo);

  // Keyboard: Esc backs out, Enter ends the turn, Ctrl+Z takes back an order, G flips map and globe.
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
      } else if (e.key.toLowerCase() === "d" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setPanel("diplomacy");
      } else if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        st.setMapView(st.mapView === "globe" ? "flat" : "globe");
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
      <Inbox />
      <DiplomacyPanel />
      <TurnDock />
      <Chronicle />
      <Toasts />
      <SeasonBanner />
      <Herald />
      <EndScreen />
      <GameMenu />
      <Settings />
      <Guide />
      <WhatsNew />
      <SaveLoad />
    </div>
  );
}
