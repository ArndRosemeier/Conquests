import type { GameState } from "../engine/state/gameState.ts";
import { deserializeGame, serializeGame } from "../engine/state/serialization.ts";

/**
 * IndexedDB-backed save/restore for games. GameState is plain JSON, so a save is
 * just the versioned serialized string plus a little metadata for the save list.
 * Two stores: named manual saves, and a rolling ring of the last few autosaves.
 */

// Kept from the game's earlier name so existing saves stay readable.
const DB_NAME = "colonial-conquest";
const DB_VERSION = 1;
const STORE_MANUAL = "saves";
const STORE_AUTO = "autosaves";
/** How many autosaves to retain (rolling window). */
export const AUTOSAVE_LIMIT = 5;

interface StoredSave {
  /** Manual saves are keyed by this name; autosaves use an auto-increment id. */
  readonly name?: string;
  readonly id?: number;
  readonly savedAt: number;
  readonly year: number;
  readonly season: string;
  readonly activePower: string | null;
  /** Versioned serialized GameState (see serialization.ts). */
  readonly payload: string;
}

/** Lightweight descriptor for the save-list UI (no heavy payload). */
export interface SaveInfo {
  /** Store key: the name for a manual save, the numeric id for an autosave. */
  readonly key: string | number;
  readonly label: string;
  readonly savedAt: number;
  readonly year: number;
  readonly season: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MANUAL)) {
        db.createObjectStore(STORE_MANUAL, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(STORE_AUTO)) {
        db.createObjectStore(STORE_AUTO, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function record(state: GameState): Omit<StoredSave, "name" | "id"> {
  return {
    savedAt: Date.now(),
    year: state.year,
    season: state.season,
    activePower: state.activePower === null ? null : String(state.activePower),
    payload: serializeGame(state),
  };
}

// --- Manual saves -----------------------------------------------------------

export async function putManualSave(name: string, state: GameState): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MANUAL, "readwrite");
  await reqAsync(tx.objectStore(STORE_MANUAL).put({ name, ...record(state) }));
}

export async function listManualSaves(): Promise<readonly SaveInfo[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_MANUAL, "readonly");
  const all = (await reqAsync(tx.objectStore(STORE_MANUAL).getAll())) as StoredSave[];
  return all
    .map((s) => ({
      key: s.name!,
      label: s.name!,
      savedAt: s.savedAt,
      year: s.year,
      season: s.season,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadManualSave(name: string): Promise<GameState> {
  const db = await openDb();
  const tx = db.transaction(STORE_MANUAL, "readonly");
  const rec = (await reqAsync(tx.objectStore(STORE_MANUAL).get(name))) as StoredSave | undefined;
  if (rec === undefined) throw new Error(`Save '${name}' not found`);
  return deserializeGame(rec.payload);
}

export async function deleteManualSave(name: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MANUAL, "readwrite");
  await reqAsync(tx.objectStore(STORE_MANUAL).delete(name));
}

// --- Autosaves (rolling) ----------------------------------------------------

export async function pushAutosave(state: GameState): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_AUTO, "readwrite");
  const store = tx.objectStore(STORE_AUTO);
  await reqAsync(store.add(record(state)));
  // Prune to the newest AUTOSAVE_LIMIT (getAllKeys returns ascending, so the
  // lowest ids are the oldest).
  const keys = await reqAsync(store.getAllKeys());
  const excess = keys.length - AUTOSAVE_LIMIT;
  for (let i = 0; i < excess; i += 1) {
    await reqAsync(store.delete(keys[i]!));
  }
}

export async function listAutosaves(): Promise<readonly SaveInfo[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_AUTO, "readonly");
  const all = (await reqAsync(tx.objectStore(STORE_AUTO).getAll())) as StoredSave[];
  return all
    .map((s) => ({
      key: s.id!,
      label: `Year ${s.year} \u00b7 ${s.season}`,
      savedAt: s.savedAt,
      year: s.year,
      season: s.season,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadAutosave(id: number): Promise<GameState> {
  const db = await openDb();
  const tx = db.transaction(STORE_AUTO, "readonly");
  const rec = (await reqAsync(tx.objectStore(STORE_AUTO).get(id))) as StoredSave | undefined;
  if (rec === undefined) throw new Error(`Autosave ${id} not found`);
  return deserializeGame(rec.payload);
}
