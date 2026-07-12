import { BUILTIN_PERSONAS, clampKnob, KNOB_KEYS } from "../controllers/ai/persona.ts";
import type { Persona, PersonaKnobs } from "../controllers/ai/persona.ts";

/**
 * Local persistence for player-authored personas. Built-in personas are code;
 * custom ones are plain JSON in localStorage, merged with the built-ins to form
 * the pool the setup screen offers and the store assigns from.
 */

const STORAGE_KEY = "colonial-conquest:personas";

/** Coerce arbitrary parsed JSON into a valid knob vector (clamped, complete). */
function sanitizeKnobs(raw: unknown): PersonaKnobs {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of KNOB_KEYS) {
    const v = obj[key];
    out[key] = clampKnob(typeof v === "number" && Number.isFinite(v) ? v : 50);
  }
  return out as unknown as PersonaKnobs;
}

function sanitizePersona(raw: unknown): Persona | null {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  return {
    id: obj.id,
    name: obj.name,
    blurb: typeof obj.blurb === "string" ? obj.blurb : "Custom persona.",
    knobs: sanitizeKnobs(obj.knobs),
    builtIn: false,
  };
}

/** All custom personas the player has saved, newest first. */
export function loadCustomPersonas(): readonly Persona[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePersona).filter((p): p is Persona => p !== null);
  } catch {
    return [];
  }
}

function writeCustomPersonas(personas: readonly Persona[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personas));
}

/** Insert or replace a custom persona (keyed by id), returning the new list. */
export function saveCustomPersona(persona: Persona): readonly Persona[] {
  const custom = loadCustomPersonas().filter((p) => p.id !== persona.id);
  const next = [{ ...persona, builtIn: false }, ...custom];
  writeCustomPersonas(next);
  return next;
}

export function deleteCustomPersona(id: string): readonly Persona[] {
  const next = loadCustomPersonas().filter((p) => p.id !== id);
  writeCustomPersonas(next);
  return next;
}

/** The full pool offered in setup: built-ins first, then custom personas. */
export function allPersonas(): readonly Persona[] {
  return [...BUILTIN_PERSONAS, ...loadCustomPersonas()];
}

/** Mint a stable-ish unique id for a newly authored persona. */
export function newPersonaId(): string {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
