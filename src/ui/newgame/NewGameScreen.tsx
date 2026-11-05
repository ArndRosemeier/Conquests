import { useState } from "react";
import type React from "react";
import type { Persona } from "../../controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../../engine/ruleset/classic.ts";
import type { PowerId } from "../../engine/types.ts";
import { SCENARIOS } from "../../engine/world/scenarios.ts";
import { sound } from "../audio/sound.ts";
import { BASE } from "../content/herald.ts";
import { lookOf, money, troops } from "../content/powers.ts";
import { allPersonas } from "../personaStore.ts";
import { useGame } from "../store.ts";
import { PersonaManager } from "./PersonaManager.tsx";

const RANDOM = "__random__";
const SCENARIO_ART: Record<string, string> = {
  standard: `${BASE}art/title-maproom.webp`,
  "1880": `${BASE}art/title-expedition.webp`,
  "1914": `${BASE}art/title-fleet.webp`,
};
const GOALS: readonly { value: number; label: string; note: string }[] = [
  { value: 500, label: "Quick", note: "500 points · about an hour" },
  { value: 1000, label: "Standard", note: "1,000 points" },
  { value: 1500, label: "Epic", note: "1,500 points" },
  { value: 0, label: "Endless", note: "Until one power is left" },
];
const QUALITY = ["", "Poor", "Fair", "Good", "Fine", "Elite"];

function Pips({ value, max = 5 }: { value: number; max?: number }): React.JSX.Element {
  return (
    <span className="pips" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? "on" : ""} />)}
    </span>
  );
}

export function NewGameScreen(): React.JSX.Element {
  const preset = useGame((s) => s.preset);
  const startGame = useGame((s) => s.startGame);
  const goTitle = useGame((s) => s.goTitle);
  const [power, setPower] = useState<PowerId>(preset ?? CLASSIC_RULESET.powers.find((p) => lookOf(String(p.id)).difficulty === "Easy")!.id);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [goal, setGoal] = useState(1000);
  const [pool, setPool] = useState<readonly Persona[]>(() => allPersonas());
  const [persona, setPersona] = useState(RANDOM);
  const [manage, setManage] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));

  const def = CLASSIC_RULESET.powers.find((p) => p.id === power)!;
  const look = lookOf(String(power));
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const setup = scenario.powers.find((x) => x.power === power);
  const army = Math.max(1, Math.min(5, Math.round(6 - (def.armyOffense + def.armyDefense) / 2)));
  const navy = Math.max(1, Math.min(5, Math.round(6 - (def.navyOffense + def.navyDefense) / 2)));

  const begin = (): void => {
    sound.play("horn");
    startGame({
      scenarioId,
      humanPower: power,
      personaMode: persona === RANDOM ? "random" : "specific",
      personaId: persona === RANDOM ? null : persona,
      personaPool: pool,
      winningScore: goal,
      seed,
    });
  };

  return (
    <div className="newgame" style={{ ["--c" as string]: def.color }}>
      <div className="newgame-bg" style={{ backgroundImage: `url(${SCENARIO_ART[scenarioId] ?? SCENARIO_ART.standard})` }} />
      <header className="newgame-head">
        <button className="btn ghost" onClick={goTitle}>← Back</button>
        <h1>New campaign</h1>
        <span />
      </header>

      <div className="newgame-body">
        <section className="step">
          <h2><b>1</b> Choose your nation</h2>
          <div className="nations">
            {CLASSIC_RULESET.powers.map((p) => {
              const l = lookOf(String(p.id));
              return (
                <button
                  key={String(p.id)}
                  className={`nation${p.id === power ? " on" : ""}`}
                  style={{ ["--c" as string]: p.color }}
                  onClick={() => { setPower(p.id); sound.play("click"); }}
                >
                  <img src={l.crest} alt="" />
                  <span>{p.name}</span>
                  <small className={`diff d-${l.difficulty.toLowerCase()}`}>{l.difficulty}</small>
                </button>
              );
            })}
          </div>
          <article className="nation-card glass" key={String(power)}>
            <img src={look.crest} alt="" className="nation-crest" />
            <div>
              <h3>{def.name} <small>· the {look.emblem}</small></h3>
              <p>{look.blurb}</p>
              <div className="nation-stats">
                <span>Army <Pips value={army} /> <em>{QUALITY[army]}</em></span>
                <span>Navy <Pips value={navy} /> <em>{QUALITY[navy]}</em></span>
                {setup && (
                  <>
                    <span>Troops <b>{troops(setup.troops)}</b></span>
                    <span>Fleets <b>{setup.fleets}</b></span>
                    <span>Treasury <b>{money(setup.treasury)}</b></span>
                    <span>10,000 troops cost <b>{money(def.armyCostPer10k)}</b></span>
                  </>
                )}
              </div>
              <ul className="nation-tags">{look.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </article>
        </section>

        <section className="step">
          <h2><b>2</b> Pick a world</h2>
          <div className="scenarios">
            {SCENARIOS.map((s) => (
              <button key={s.id} className={`scenario${s.id === scenarioId ? " on" : ""}`} onClick={() => setScenarioId(s.id)}>
                <img src={SCENARIO_ART[s.id] ?? SCENARIO_ART.standard} alt="" />
                <div>
                  <b>{s.name}</b>
                  <span>{s.blurb}</span>
                </div>
              </button>
            ))}
          </div>

          <h2><b>3</b> How long?</h2>
          <div className="segmented goals">
            {GOALS.map((g) => (
              <button key={g.value} className={g.value === goal ? "on" : ""} onClick={() => setGoal(g.value)}>
                <b>{g.label}</b>
                <small>{g.note}</small>
              </button>
            ))}
          </div>

          <h2><b>4</b> Your rivals</h2>
          <div className="rivals">
            <select value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value={RANDOM}>A mix of personalities</option>
              {pool.map((p) => (
                <option key={p.id} value={p.id}>All {p.name}{p.builtIn ? "" : " (custom)"}</option>
              ))}
            </select>
            <button className="btn ghost" onClick={() => setManage(true)}>Edit personalities</button>
          </div>
          <p className="muted small">
            {persona === RANDOM ? "Every rival gets a different temperament: some greedy, some careful, some bold at sea." : pool.find((p) => p.id === persona)?.blurb}
          </p>

          <button className="link-btn" onClick={() => setAdvanced(!advanced)}>{advanced ? "▾" : "▸"} Advanced</button>
          {advanced && (
            <label className="seed">
              Map seed
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              <button className="btn ghost small" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}>🎲</button>
            </label>
          )}
        </section>
      </div>

      <footer className="newgame-foot">
        <div className="newgame-summary">
          <img src={look.crest} alt="" />
          <span>{def.name} · {scenario.name} · {GOALS.find((g) => g.value === goal)?.label}</span>
        </div>
        <button className="btn primary big" onClick={begin}>Begin the campaign</button>
      </footer>

      {manage && (
        <PersonaManager
          pool={pool}
          onChange={(next, selectId) => {
            setPool(next);
            if (selectId !== undefined) setPersona(selectId);
          }}
          onClose={() => setManage(false)}
        />
      )}
    </div>
  );
}
