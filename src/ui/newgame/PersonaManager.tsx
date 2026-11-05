import { useState } from "react";
import type React from "react";
import { KNOB_KEYS, KNOB_LABELS, NEUTRAL_KNOB, clampKnob, knobs as buildKnobs } from "../../controllers/ai/persona.ts";
import type { Persona, PersonaKnobs } from "../../controllers/ai/persona.ts";
import type { SeatPersona } from "../../game/simulation.ts";
import { deleteCustomPersona, newPersonaId, saveCustomPersona } from "../personaStore.ts";
import { PersonaCrashTest } from "./PersonaCrashTest.tsx";

const toSeat = (p: Persona): SeatPersona => ({ id: p.id, name: p.name, knobs: p.knobs });

interface PersonaManagerProps {
  readonly pool: readonly Persona[];
  readonly onChange: (next: readonly Persona[], selectId?: string) => void;
  readonly onClose: () => void;
}

/** A lightweight editor for creating, tuning, and crash-testing personas. */
export function PersonaManager({ pool, onChange, onClose }: PersonaManagerProps): React.JSX.Element {
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
    <div className="overlay" onClick={onClose}>
      <div className="modal glass persona-modal" onClick={(e) => e.stopPropagation()}>
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
