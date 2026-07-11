import type React from "react";
import { MapView } from "./map/MapView.tsx";
import { Hud } from "./panels/Hud.tsx";
import { PhasePanel } from "./panels/PhasePanel.tsx";
import { Sidebar } from "./panels/Sidebar.tsx";
import { SetupScreen } from "./SetupScreen.tsx";
import { useGame } from "./store.ts";

export function App(): React.JSX.Element {
  const screen = useGame((s) => s.screen);

  if (screen === "setup") {
    return <SetupScreen />;
  }

  return (
    <div className="game">
      <Hud />
      <div className="game-body">
        <div className="left-col">
          <PhasePanel />
        </div>
        <MapView />
        <Sidebar />
      </div>
    </div>
  );
}
