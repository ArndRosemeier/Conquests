import { useCallback, useEffect, useState } from "react";
import type React from "react";
import {
  deleteManualSave,
  listAutosaves,
  listManualSaves,
  loadAutosave,
  loadManualSave,
} from "../persistence.ts";
import type { SaveInfo } from "../persistence.ts";
import { useGame } from "../store.ts";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}

export function SaveLoad(): React.JSX.Element | null {
  const open = useGame((s) => s.saveLoadOpen);
  const setOpen = useGame((s) => s.setSaveLoadOpen);
  const gameState = useGame((s) => s.gameState);
  const saveGame = useGame((s) => s.saveGame);
  const loadGame = useGame((s) => s.loadGame);

  const [manual, setManual] = useState<readonly SaveInfo[]>([]);
  const [autos, setAutos] = useState<readonly SaveInfo[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [m, a] = await Promise.all([listManualSaves(), listAutosaves()]);
    setManual(m);
    setAutos(a);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void refresh();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, refresh, setOpen]);

  if (!open) return null;

  const canSave = gameState !== null;
  const defaultName = gameState ? `Year ${gameState.year} ${gameState.season}` : "Save";

  const doSave = async (): Promise<void> => {
    const label = (name.trim() || defaultName).slice(0, 60);
    setBusy(true);
    setError(null);
    try {
      await saveGame(label);
      setName("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doLoadManual = async (key: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      loadGame(await loadManualSave(key));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const doLoadAuto = async (id: number): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      loadGame(await loadAutosave(id));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const doDelete = async (key: string): Promise<void> => {
    setBusy(true);
    try {
      await deleteManualSave(key);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Save &amp; Load</h2>
          <button className="popup-x" aria-label="Close" onClick={() => setOpen(false)}>
            {"\u00d7"}
          </button>
        </div>

        <div className="modal-body">
          {error !== null && <p className="danger">{error}</p>}

          {canSave && (
            <section>
              <h3>Save current game</h3>
              <div className="save-row">
                <input
                  type="text"
                  placeholder={defaultName}
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doSave();
                  }}
                />
                <button className="btn primary" disabled={busy} onClick={() => void doSave()}>
                  Save
                </button>
              </div>
              <p className="muted small">Saving under an existing name overwrites that slot.</p>
            </section>
          )}

          <section>
            <h3>Saved games</h3>
            {manual.length === 0 ? (
              <p className="muted small">No saved games yet.</p>
            ) : (
              <ul className="save-list">
                {manual.map((s) => (
                  <li key={String(s.key)}>
                    <div className="save-meta">
                      <span className="save-name">{s.label}</span>
                      <span className="muted small">
                        Year {s.year} {"\u00b7"} {s.season} {"\u00b7"} {timeAgo(s.savedAt)}
                      </span>
                    </div>
                    <div className="save-actions">
                      <button className="btn small" disabled={busy} onClick={() => void doLoadManual(String(s.key))}>
                        Load
                      </button>
                      <button className="btn small ghost" disabled={busy} onClick={() => void doDelete(String(s.key))}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Autosaves (last {autos.length})</h3>
            {autos.length === 0 ? (
              <p className="muted small">No autosaves yet.</p>
            ) : (
              <ul className="save-list">
                {autos.map((s) => (
                  <li key={String(s.key)}>
                    <div className="save-meta">
                      <span className="save-name">{s.label}</span>
                      <span className="muted small">{timeAgo(s.savedAt)}</span>
                    </div>
                    <div className="save-actions">
                      <button className="btn small" disabled={busy} onClick={() => void doLoadAuto(Number(s.key))}>
                        Load
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
