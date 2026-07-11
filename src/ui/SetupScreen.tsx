import { useState } from "react";
import type React from "react";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import type { PowerId } from "../engine/types.ts";
import { SCENARIOS } from "../engine/world/scenarios.ts";
import { useGame } from "./store.ts";

export function SetupScreen(): React.JSX.Element {
  const startGame = useGame((s) => s.startGame);
  const setSaveLoadOpen = useGame((s) => s.setSaveLoadOpen);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [humanPower, setHumanPower] = useState<PowerId>(CLASSIC_RULESET.playOrder[0]!);
  const [aiLevel, setAiLevel] = useState(4);
  const [winningScore, setWinningScore] = useState(1000);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>Colonial Conquest</h1>
        <p className="subtitle">Empire building, 1880 - 1914. A modern remake.</p>

        <label>
          Scenario
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Play as
          <div className="power-picker">
            {CLASSIC_RULESET.powers.map((p) => (
              <button
                key={String(p.id)}
                className={`power-chip ${humanPower === p.id ? "active" : ""}`}
                style={{ borderColor: p.color }}
                onClick={() => setHumanPower(p.id)}
              >
                <span className="dot" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
        </label>

        <label>
          AI difficulty: {aiLevel}
          <input type="range" min={0} max={9} value={aiLevel} onChange={(e) => setAiLevel(Number(e.target.value))} />
        </label>

        <label>
          Winning score
          <select value={winningScore} onChange={(e) => setWinningScore(Number(e.target.value))}>
            <option value={500}>500 (quick)</option>
            <option value={1000}>1000</option>
            <option value={1500}>1500 (long)</option>
          </select>
        </label>

        <label>
          Seed
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>

        <button
          className="btn primary large"
          onClick={() => startGame({ scenarioId, humanPower, aiLevel, winningScore, seed })}
        >
          Begin Conquest
        </button>
        <button className="btn large" onClick={() => setSaveLoadOpen(true)}>
          Load Game
        </button>
      </div>
    </div>
  );
}
