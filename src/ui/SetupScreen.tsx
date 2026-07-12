import { useState } from "react";
import type React from "react";
import {
  KNOB_KEYS,
  KNOB_LABELS,
  NEUTRAL_KNOB,
  clampKnob,
  knobs as buildKnobs,
} from "../controllers/ai/persona.ts";
import type { Persona, PersonaKnobs } from "../controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import type { PowerId } from "../engine/types.ts";
import { SCENARIOS } from "../engine/world/scenarios.ts";
import type { SeatPersona } from "../game/simulation.ts";
import { PersonaCrashTest } from "./panels/PersonaCrashTest.tsx";
import {
  allPersonas,
  deleteCustomPersona,
  newPersonaId,
  saveCustomPersona,
} from "./personaStore.ts";
import { useGame } from "./store.ts";

const toSeat = (p: Persona): SeatPersona => ({ id: p.id, name: p.name, knobs: p.knobs });

const RANDOM = "__random__";

export function SetupScreen(): React.JSX.Element {
  const startGame = useGame((s) => s.startGame);
  const setSaveLoadOpen = useGame((s) => s.setSaveLoadOpen);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [humanPower, setHumanPower] = useState<PowerId>(CLASSIC_RULESET.playOrder[0]!);
  const [winningScore, setWinningScore] = useState(1000);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));

  const [pool, setPool] = useState<readonly Persona[]>(() => allPersonas());
  const [personaChoice, setPersonaChoice] = useState<string>(RANDOM);
  const [manageOpen, setManageOpen] = useState(false);

  const begin = (): void => {
    startGame({
      scenarioId,
      humanPower,
      personaMode: personaChoice === RANDOM ? "random" : "specific",
      personaId: personaChoice === RANDOM ? null : personaChoice,
      personaPool: pool,
      winningScore,
      seed,
    });
  };

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
          Opponents
          <select value={personaChoice} onChange={(e) => setPersonaChoice(e.target.value)}>
            <option value={RANDOM}>Random (shuffle personas)</option>
            {pool.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.builtIn ? "" : " (custom)"}
              </option>
            ))}
          </select>
        </label>
        <p className="persona-hint">
          {personaChoice === RANDOM
            ? "Each AI gets a different persona, dealt from the pool."
            : (pool.find((p) => p.id === personaChoice)?.blurb ?? "")}
          <button className="link-btn" onClick={() => setManageOpen(true)}>
            Manage personas
          </button>
        </p>

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

        <button className="btn primary large" onClick={begin}>
          Begin Conquest
        </button>
        <button className="btn large" onClick={() => setSaveLoadOpen(true)}>
          Load Game
        </button>
      </div>

      {manageOpen && (
        <PersonaManager
          pool={pool}
          onChange={(next, selectId) => {
            setPool(next);
            if (selectId !== undefined) setPersonaChoice(selectId);
          }}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}

interface PersonaManagerProps {
  readonly pool: readonly Persona[];
  readonly onChange: (next: readonly Persona[], selectId?: string) => void;
  readonly onClose: () => void;
}

/** A lightweight editor for creating, tuning, and crash-testing personas. */
function PersonaManager({ pool, onChange, onClose }: PersonaManagerProps): React.JSX.Element {
  const [draft, setDraft] = useState<Persona | null>(null);
  const [testing, setTesting] = useState<SeatPersona | null>(null);

  const startNew = (): void => {
    setDraft({
      id: newPersonaId(),
      name: "New Persona",
      blurb: "Custom persona.",
      knobs: buildKnobs({}),
      builtIn: false,
    });
  };

  const editCopy = (p: Persona): void => {
    setDraft(
      p.builtIn
        ? { id: newPersonaId(), name: `${p.name} (copy)`, blurb: p.blurb, knobs: p.knobs, builtIn: false }
        : { ...p },
    );
  };

  const save = (): void => {
    if (draft === null) return;
    const cleaned: Persona = { ...draft, name: draft.name.trim() || "Custom Persona" };
    const next = saveCustomPersona(cleaned);
    onChange([...pool.filter((p) => p.builtIn), ...next], cleaned.id);
    setDraft(null);
  };

  const remove = (id: string): void => {
    const next = deleteCustomPersona(id);
    onChange([...pool.filter((p) => p.builtIn), ...next]);
    if (draft?.id === id) setDraft(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal persona-modal" onClick={(e) => e.stopPropagation()}>
        {testing !== null ? (
          <PersonaCrashTest persona={testing} onBack={() => setTesting(null)} />
        ) : (
          <>
            <div className="modal-head">
              <h2>Personas</h2>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="modal-body">
              {draft === null ? (
                <>
                  <div className="persona-list">
                    {pool.map((p) => (
                      <div key={p.id} className="persona-row">
                        <div className="persona-row-main">
                          <strong>{p.name}</strong>
                          {!p.builtIn && <span className="tag">custom</span>}
                          <span className="persona-blurb">{p.blurb}</span>
                        </div>
                        <div className="persona-row-actions">
                          <button className="btn small" onClick={() => setTesting(toSeat(p))}>
                            Test
                          </button>
                          <button className="btn small" onClick={() => editCopy(p)}>
                            {p.builtIn ? "Duplicate" : "Edit"}
                          </button>
                          {!p.builtIn && (
                            <button className="btn small danger" onClick={() => remove(p.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="btn primary" onClick={startNew}>
                    New persona
                  </button>
                </>
              ) : (
                <PersonaEditor
                  draft={draft}
                  onDraft={setDraft}
                  onSave={save}
                  onCancel={() => setDraft(null)}
                  onTest={() => setTesting(toSeat(draft))}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PersonaEditorProps {
  readonly draft: Persona;
  readonly onDraft: (p: Persona) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onTest: () => void;
}

function PersonaEditor({ draft, onDraft, onSave, onCancel, onTest }: PersonaEditorProps): React.JSX.Element {
  const setKnob = (key: keyof PersonaKnobs, value: number): void => {
    onDraft({ ...draft, knobs: { ...draft.knobs, [key]: clampKnob(value) } });
  };

  return (
    <div className="persona-editor">
      <label>
        Name
        <input value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
      </label>
      <label>
        Description
        <input value={draft.blurb} onChange={(e) => onDraft({ ...draft, blurb: e.target.value })} />
      </label>

      {KNOB_KEYS.map((key) => (
        <label key={key} className="knob-row">
          <span className="knob-label">
            {KNOB_LABELS[key]}: {draft.knobs[key]}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.knobs[key]}
            onChange={(e) => setKnob(key, Number(e.target.value))}
          />
        </label>
      ))}
      <p className="persona-hint">{NEUTRAL_KNOB} is the neutral baseline for every trait.</p>

      <div className="modal-head">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <div className="persona-row-actions">
          <button className="btn" onClick={onTest}>
            Crash test
          </button>
          <button className="btn primary" onClick={onSave}>
            Save persona
          </button>
        </div>
      </div>
    </div>
  );
}
