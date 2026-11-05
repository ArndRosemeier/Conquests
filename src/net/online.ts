import type { Action } from "../engine/state/actions.ts";
import type { GameEvent } from "../engine/state/events.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { GAMEHUB } from "./config.ts";
import { connect } from "./gamehub.ts";
import type { GameHub, RoomSummary } from "./gamehub.ts";
import { newToken, pack, PROTOCOL, seatKey, unpack } from "./protocol.ts";
import type { GameSettings, NetMessage, RoomMeta, RoomState, ToHost } from "./protocol.ts";

/**
 * One online game on GameHub, without any UI: lobby, seats, intents, reconnects and host
 * migration. The store drives the game itself (on the host) and listens through the `on...` hooks.
 */

export type Hub = GameHub<RoomState, never, NetMessage>;

/** An intent from a seated player, after the host checked their seat token. */
export type Intent = { k: "act"; action: Action } | { k: "end" } | { k: "undo" };

export interface OnlineOptions {
  name: string;
  hub?: Hub;
  url?: string;
  appKey?: string;
}

export interface ChatLine {
  name: string;
  power: string | null;
  text: string;
}

/** Seat tokens live per browser tab, so two tabs are two players and a reload keeps your nation. */
const SEATS_KEY = "conquests.online.seats";
const NAME_KEY = "conquests.online.name";
const PUBLISH_MS = 120;
const MAX_PLAYERS = 12;

function loadTokens(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SEATS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveToken(room: string, token: string): void {
  try {
    const all = { ...loadTokens(), [room]: token };
    sessionStorage.setItem(SEATS_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-20))));
  } catch {
    /* no reconnect after a reload, nothing worse */
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* not remembered */
  }
}

export class OnlineRoom {
  readonly hub: Hub;
  name: string;
  room: RoomState | null = null;
  game: GameState | null = null;
  error: string | null = null;
  chat: ChatLine[] = [];
  /** Bumped on every change so React can re-render cheaply. */
  version = 0;

  /** A new game state arrived (clients; also the host's own echo is skipped). `fresh`: the first one after joining. */
  onGame?: (state: GameState, events: readonly GameEvent[], fresh: boolean) => void;
  /** Host: a seated player wants something. */
  onIntent?: (power: string, intent: Intent, from: number) => void;
  /** We just became the host (the previous one left): take over the game. */
  onBecomeHost?: () => void;
  /** Host: a seated player came or went, so their nation switches between them and the computer. */
  onSeatsChanged?: () => void;
  onNotice?: (text: string) => void;

  private token: string | null = null;
  private hosting = false;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private lastN = -1;
  private gotGame = false;
  private pending: { state: GameState; events: GameEvent[]; undo: string | null } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private n = 0;

  constructor(opts: OnlineOptions) {
    this.name = opts.name.trim().slice(0, 24) || "Player";
    this.hub =
      opts.hub ??
      connect<RoomState, never, NetMessage>({
        url: opts.url ?? GAMEHUB.url,
        app: GAMEHUB.app,
        appKey: opts.appKey ?? GAMEHUB.appKey,
        name: this.name,
      });
    const hub = this.hub;
    hub.on("joined", () => queueMicrotask(() => this.enqueue(() => this.afterJoin())));
    hub.on("state", (data) => this.enqueue(() => this.onRoomState(data)));
    hub.on("msg", (m, from) => this.enqueue(() => this.onMessage(m, from)));
    hub.on("player+", () => this.changed());
    hub.on("player-", (id) => this.enqueue(() => this.onPlayerLeft(id)));
    hub.on("host", (id) => this.enqueue(() => this.onHostChanged(id)));
    hub.on("need-snapshot", () => this.enqueue(() => this.flushNow()));
    hub.on("close", () => {
      if (!this.error) this.error = "The connection to the game server was lost. Reload the page to rejoin: your nation is kept for you.";
      this.changed();
    });
    hub.on("error", (e) => {
      if (e.code === "rate_limited") this.notice("The game server asked us to slow down.");
    });
  }

  // ------------------------------------------------------------------ public API

  get ready(): Promise<unknown> {
    return this.hub.ready;
  }

  get code(): string | null {
    return this.hub.room?.id ?? null;
  }

  get isHost(): boolean {
    return this.hosting;
  }

  /** The nation our seat token holds, or null while we only watch. */
  get seat(): string | null {
    if (!this.room || !this.token) return null;
    const key = seatKey(this.token);
    return Object.entries(this.room.seats).find(([, s]) => s.key === key)?.[0] ?? null;
  }

  get people(): string[] {
    return this.hub.players.map((p) => p.name);
  }

  /** Is the player of that nation connected right now? */
  seatOnline(power: string): boolean {
    const pid = this.room?.seats[power]?.pid ?? null;
    return pid !== null && this.hub.players.some((p) => p.id === pid);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  watchLobby(fn: (rooms: RoomSummary[]) => void): () => void {
    return this.hub.watchLobby(fn);
  }

  /** Opens a room with these settings; we take `power`. Returns the join code. */
  async host(settings: GameSettings, power: string): Promise<string> {
    await this.hub.ready;
    const summary = await this.hub.create({ name: `${this.name}'s world`.slice(0, 40), public: true, maxPlayers: MAX_PLAYERS, meta: null });
    await this.enqueue(async () => {
      this.hosting = true;
      this.token = newToken();
      saveToken(summary.id, this.token);
      this.room = { v: PROTOCOL, phase: "lobby", settings, seats: { [power]: { name: this.name, key: seatKey(this.token), pid: this.hub.you } } };
      this.publishRoom();
    });
    return summary.id;
  }

  async join(code: string): Promise<void> {
    await this.hub.ready;
    const id = code.trim().toUpperCase();
    this.token = loadTokens()[id] ?? null;
    await this.hub.join(id);
  }

  claim(power: string): void {
    const code = this.code;
    if (!code || this.room?.phase !== "lobby") return;
    if (!this.token) {
      this.token = newToken();
      saveToken(code, this.token);
    }
    this.toHost({ k: "claim", power, token: this.token, name: this.name });
  }

  release(): void {
    if (this.token && this.room?.phase === "lobby") this.toHost({ k: "release", token: this.token });
  }

  /** Host: lobby settings. */
  setSettings(settings: GameSettings): void {
    void this.enqueue(() => {
      if (!this.hosting || this.room?.phase !== "lobby") return;
      this.room = { ...this.room, settings };
      this.publishRoom();
    });
  }

  /** Host: the game starts from `initial`. */
  start(initial: GameState): void {
    void this.enqueue(async () => {
      if (!this.hosting || !this.room) return;
      this.room = { ...this.room, phase: "playing" };
      this.game = initial;
      this.hub.setRoom({ public: false });
      this.pending = { state: initial, events: [], undo: null };
      await this.flushNow();
    });
  }

  /** Host: publish a new game state. Bursts (fast computer turns) are batched into one message. */
  publish(state: GameState, events: readonly GameEvent[], undo: string | null): void {
    if (!this.hosting) return;
    this.game = state;
    this.pending = { state, events: [...(this.pending?.events ?? []), ...events], undo };
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      void this.enqueue(() => this.flushNow());
    }, PUBLISH_MS);
  }

  /** Host: tell one player that their request was refused. */
  refuse(to: number, reason: string): void {
    this.hub.send({ k: "refused", reason }, to);
  }

  act(action: Action): void {
    if (this.token) this.toHost({ k: "act", token: this.token, action });
  }

  endTurn(): void {
    if (this.token) this.toHost({ k: "end", token: this.token });
  }

  undo(): void {
    if (this.token) this.toHost({ k: "undo", token: this.token });
  }

  say(text: string): void {
    const t = text.trim().slice(0, 300);
    if (!t) return;
    const line: ChatLine = { name: this.name, power: this.seat, text: t };
    this.hub.send({ k: "chat", ...line });
    this.addChat(line);
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listeners.clear();
    this.hub.close();
  }

  // ------------------------------------------------------------------ plumbing

  private enqueue(job: () => void | Promise<void>): Promise<void> {
    const next = this.queue.then(job).catch((e: unknown) => {
      console.error("online game:", e);
      this.notice(`Something went wrong in the online game: ${(e as Error).message}`);
    });
    this.queue = next;
    return next;
  }

  private changed(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  private notice(text: string): void {
    this.onNotice?.(text);
  }

  private addChat(line: ChatLine): void {
    this.chat = [...this.chat, line].slice(-100);
    this.changed();
  }

  private toHost(m: ToHost): void {
    if (this.hosting) void this.enqueue(() => this.handleHostMessage(m, this.hub.you ?? -1));
    else if (this.hub.host !== null) this.hub.send(m, this.hub.host);
  }

  private publishRoom(): void {
    if (!this.room) return;
    const { game: _g, events: _e, ...rest } = this.room;
    void _g;
    void _e;
    // Lobby changes: send the room without re-sending events, but keep the packed game.
    this.hub.setState({ ...rest, ...(this.room.game !== undefined ? { game: this.room.game } : {}) });
    const meta: RoomMeta = { v: PROTOCOL, phase: this.room.phase, scenario: this.room.settings.scenarioId, host: this.name, seats: Object.keys(this.room.seats).length };
    this.hub.setRoom({ meta });
    this.changed();
  }

  private async flushNow(): Promise<void> {
    if (!this.hosting || !this.room) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const p = this.pending;
    this.pending = null;
    if (p !== null) {
      this.n += 1;
      this.room = { ...this.room, game: await pack(p.state), events: p.events, n: this.n, undo: p.undo };
      this.lastN = this.n;
    }
    this.hub.setState(this.room);
    this.changed();
  }

  private async afterJoin(): Promise<void> {
    // Introduce ourselves so a returning player gets their nation back.
    if (!this.hosting) this.toHost({ k: "hello", token: this.token });
    if (this.room && this.room.v !== PROTOCOL) this.error = "This room runs a different version of Conquests. Reload the page to update.";
    this.changed();
  }

  private async onRoomState(data: RoomState): Promise<void> {
    if (this.hosting) return; // our own state comes back to us; we already have it
    if (data.v !== PROTOCOL) {
      this.error = "This room runs a different version of Conquests. Reload the page to update.";
      this.room = data;
      this.changed();
      return;
    }
    this.room = data;
    if (data.game !== undefined && (data.n ?? 0) !== this.lastN) {
      this.lastN = data.n ?? 0;
      const state = await unpack<GameState>(data.game);
      this.game = state;
      const fresh = !this.gotGame;
      this.gotGame = true;
      this.onGame?.(state, fresh ? [] : data.events ?? [], fresh);
    }
    this.changed();
  }

  private async onMessage(m: NetMessage, from: number): Promise<void> {
    switch (m.k) {
      case "chat":
        this.addChat({ name: m.name, power: m.power, text: m.text });
        return;
      case "refused":
        this.notice(m.reason);
        return;
      default:
        if (this.hosting) await this.handleHostMessage(m, from);
    }
  }

  private powerOf(token: string): string | null {
    if (!this.room) return null;
    const key = seatKey(token);
    return Object.entries(this.room.seats).find(([, s]) => s.key === key)?.[0] ?? null;
  }

  private async handleHostMessage(m: ToHost, from: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    const name = this.hub.players.find((p) => p.id === from)?.name ?? "Player";
    switch (m.k) {
      case "claim": {
        if (room.phase !== "lobby") return this.refuse(from, "The game has already started.");
        const taken = room.seats[m.power];
        if (taken && taken.key !== seatKey(m.token)) return this.refuse(from, `${taken.name} already plays that nation.`);
        const seats = Object.fromEntries(Object.entries(room.seats).filter(([, s]) => s.key !== seatKey(m.token)));
        seats[m.power] = { name: m.name.slice(0, 24) || name, key: seatKey(m.token), pid: from };
        this.room = { ...room, seats };
        this.publishRoom();
        return;
      }
      case "release": {
        if (room.phase !== "lobby") return;
        const seats = Object.fromEntries(Object.entries(room.seats).filter(([, s]) => s.key !== seatKey(m.token)));
        this.room = { ...room, seats };
        this.publishRoom();
        return;
      }
      case "hello": {
        const power = m.token ? this.powerOf(m.token) : null;
        if (power === null) return;
        const seat = room.seats[power]!;
        this.room = { ...room, seats: { ...room.seats, [power]: { ...seat, pid: from } } };
        if (room.phase === "playing") this.pending ??= this.game ? { state: this.game, events: [], undo: room.undo ?? null } : null;
        await this.flushNow();
        this.onSeatsChanged?.();
        return;
      }
      case "act":
      case "end":
      case "undo": {
        const power = this.powerOf(m.token);
        if (power === null || room.phase !== "playing") return;
        const intent: Intent = m.k === "act" ? { k: "act", action: m.action } : { k: m.k };
        this.onIntent?.(power, intent, from);
        return;
      }
    }
  }

  private async onPlayerLeft(id: number): Promise<void> {
    if (this.hosting && this.room) {
      const entry = Object.entries(this.room.seats).find(([, s]) => s.pid === id);
      if (entry) {
        const [power, seat] = entry;
        if (this.room.phase === "lobby") {
          const { [power]: _gone, ...rest } = this.room.seats;
          void _gone;
          this.room = { ...this.room, seats: rest };
          this.publishRoom();
        } else {
          this.room = { ...this.room, seats: { ...this.room.seats, [power]: { ...seat, pid: null } } };
          this.notice(`${seat.name} left. The computer plays their nation until they return.`);
          this.publishRoom();
          this.onSeatsChanged?.();
        }
      }
    }
    this.changed();
  }

  private async onHostChanged(id: number): Promise<void> {
    if (id !== this.hub.you || this.hosting) {
      this.changed();
      return;
    }
    this.hosting = true;
    if (this.room) {
      // Seats whose players are gone (the old host among them) are played by the computer for now.
      const here = new Set(this.hub.players.map((p) => p.id));
      const seats = Object.fromEntries(
        Object.entries(this.room.seats).map(([power, s]) => [power, { ...s, pid: s.pid !== null && here.has(s.pid) ? s.pid : null }]),
      );
      this.room = { ...this.room, seats };
      this.n = this.room.n ?? 0;
    }
    this.notice("The host left. Your browser now runs the game.");
    this.onBecomeHost?.();
    if (this.room?.phase === "lobby") this.publishRoom();
    this.changed();
  }
}
