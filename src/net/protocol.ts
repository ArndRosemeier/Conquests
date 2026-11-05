import type { Action } from "../engine/state/actions.ts";
import type { GameEvent } from "../engine/state/events.ts";

/**
 * What Conquests sends over a GameHub room. No DOM, so it also runs in Node tests.
 *
 * The host runs the game. The room's state is the lobby (settings and seats) plus, once the game
 * runs, the whole packed GameState and the events that led to it. Players send intents ("this
 * action", "end my turn", "undo") to the host, which checks and applies them and publishes the
 * new state to everyone.
 */

/** Bumped when the messages change in a way older builds cannot read. */
export const PROTOCOL = 1;

/** A claimed nation: who plays it, a fingerprint of their secret seat token, and their connection. */
export interface Seat {
  name: string;
  key: string;
  /** GameHub player id while connected, null while away (the computer stands in). */
  pid: number | null;
}

export interface GameSettings {
  scenarioId: string;
  winningScore: number;
  seed: number;
}

export interface RoomState {
  v: number;
  phase: "lobby" | "playing";
  settings: GameSettings;
  /** Claimed nations by power id. Unclaimed nations are played by the computer. */
  seats: Record<string, Seat>;
  /** Packed GameState once the game runs. */
  game?: string;
  /** Events since the previous publish, for battle animations, sounds and the newspaper. */
  events?: GameEvent[];
  /** Publish counter, so a client can tell new states from replays. */
  n?: number;
  /** Power whose current turn can be undone, if any. */
  undo?: string | null;
}

export type ToHost =
  | { k: "claim"; power: string; token: string; name: string }
  | { k: "release"; token: string }
  /** Sent after joining: "this is my seat token" (or none), so a returning player gets their nation back. */
  | { k: "hello"; token: string | null }
  | { k: "act"; token: string; action: Action }
  | { k: "end"; token: string }
  | { k: "undo"; token: string };

export type FromHost = { k: "refused"; reason: string };

export type ToAll = { k: "chat"; name: string; power: string | null; text: string };

export type NetMessage = ToHost | FromHost | ToAll;

/** Lobby listing info, set by the host. */
export interface RoomMeta {
  v: number;
  phase: "lobby" | "playing";
  scenario: string;
  host: string;
  seats: number;
}

/** A short, stable fingerprint of a seat token (FNV-1a, twice), so the room never shows the token itself. */
export function seatKey(token: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ token.length;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

/** JSON, gzipped and base64-encoded: a game state shrinks from about 40 KB to 4 KB. */
export async function pack(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function unpack<T>(data: string): Promise<T> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as T;
}

export function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
