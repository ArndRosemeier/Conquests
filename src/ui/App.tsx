import { useEffect } from "react";
import type React from "react";
import { sound } from "./audio/sound.ts";
import { GameScreen } from "./game/GameScreen.tsx";
import { Guide, Settings } from "./game/Overlays.tsx";
import { SaveLoad } from "./game/SaveLoad.tsx";
import { NewGameScreen } from "./newgame/NewGameScreen.tsx";
import { inviteCode, OnlineScreen } from "./online/OnlineScreen.tsx";
import { useGame } from "./store.ts";
import { TitleScreen } from "./title/TitleScreen.tsx";

export function App(): React.JSX.Element {
  const screen = useGame((s) => s.screen);
  const goOnline = useGame((s) => s.goOnline);

  // An invite link (?room=CODE) opens the online screen with the code filled in.
  useEffect(() => {
    if (inviteCode()) goOnline();
  }, [goOnline]);

  // Browsers only allow sound after a user gesture.
  useEffect(() => {
    const unlock = (): void => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  if (screen === "game") return <GameScreen />;
  return (
    <>
      {screen === "title" ? <TitleScreen /> : screen === "online" ? <OnlineScreen /> : <NewGameScreen />}
      <SaveLoad />
      <Guide />
      <Settings />
    </>
  );
}
