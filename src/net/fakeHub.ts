/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helper, adapted from StarLord: an in-memory GameHub relay.
import type { CreateRoomOptions, GameHub, HubEvents, PlayerInfo, RoomSummary } from "./gamehub.ts";

/**
 * An in-memory stand-in for the GameHub server, with the same relay rules (docs/PROTOCOL.md):
 * the host's state and deltas are kept and replayed to joiners, messages go to one player or
 * everyone else, and when the host leaves the lowest player id takes over. Delivery is async
 * and in order, like a socket.
 */
interface Room {
  summary: RoomSummary;
  members: FakeHub[];
  snapshot: { seq: number; data: unknown } | null;
  deltas: { seq: number; data: unknown }[];
  seq: number;
}

export class FakeRelay {
  rooms = new Map<string, Room>();
  private nextId = 1;
  private nextRoom = 0;

  connect(name: string): FakeHub {
    return new FakeHub(this, this.nextId++, name);
  }

  newCode(): string {
    return `ROOM${String(this.nextRoom++).padStart(2, "0")}`;
  }
}

type AnyFn = (...args: any[]) => void;

export class FakeHub implements GameHub<any, any, any> {
  readonly ready: Promise<{ you: number; name: string }>;
  host: number | null = null;
  room: RoomSummary | null = null;
  closed = false;
  private handlers = new Map<string, Set<AnyFn>>();
  private r: Room | null = null;

  constructor(private relay: FakeRelay, readonly you: number, readonly name: string) {
    this.ready = Promise.resolve({ you, name });
  }

  get isHost(): boolean {
    return this.host === this.you;
  }

  get players(): PlayerInfo[] {
    return (this.r?.members ?? []).map((m) => ({ id: m.you, name: m.name }));
  }

  on<E extends keyof HubEvents<any, any, any>>(event: E, fn: HubEvents<any, any, any>[E]): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn as AnyFn);
    return () => this.handlers.get(event)?.delete(fn as AnyFn);
  }

  /** Delivers an event later, as the network would, after copying its data. */
  deliver(event: string, ...args: unknown[]): void {
    const copy = args.map((a) => (a === undefined ? a : JSON.parse(JSON.stringify(a))));
    setTimeout(() => {
      if (this.closed) return;
      this.apply(event, copy);
      for (const fn of this.handlers.get(event) ?? []) fn(...copy);
    }, 0);
  }

  private apply(event: string, args: unknown[]): void {
    if (event === "host") this.host = args[0] as number;
  }

  async listRooms(): Promise<RoomSummary[]> {
    return [...this.relay.rooms.values()].map((r) => r.summary).filter((s) => s.public && s.players > 0);
  }

  watchLobby(onRooms: (rooms: RoomSummary[]) => void): () => void {
    void this.listRooms().then(onRooms);
    return () => {};
  }

  async create(opts: CreateRoomOptions = {}): Promise<RoomSummary> {
    const id = this.relay.newCode();
    const r: Room = {
      summary: { id, name: opts.name ?? id, public: opts.public ?? true, players: 0, maxPlayers: opts.maxPlayers ?? 8, meta: opts.meta ?? null, host: this.you, createdAt: 0 },
      members: [], snapshot: null, deltas: [], seq: 0,
    };
    this.relay.rooms.set(id, r);
    return this.enter(r);
  }

  async join(roomId: string): Promise<RoomSummary> {
    const r = this.relay.rooms.get(roomId.toUpperCase());
    if (!r) throw Object.assign(new Error("gamehub: no_such_room"), { code: "no_such_room" });
    return this.enter(r);
  }

  private enter(r: Room): Promise<RoomSummary> {
    for (const m of r.members) m.deliver("player+", { id: this.you, name: this.name });
    r.members.push(this);
    if (r.members.length === 1) r.summary.host = this.you;
    r.summary.players = r.members.length;
    this.r = r;
    this.room = r.summary;
    this.host = r.summary.host;
    const players = this.players;
    // As the real client: joined, then the snapshot, then the deltas, all in one burst.
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.closed) return;
        for (const fn of this.handlers.get("joined") ?? []) fn(r.summary, { you: this.you, host: r.summary.host, players });
        if (r.snapshot) for (const fn of this.handlers.get("state") ?? []) fn(JSON.parse(JSON.stringify(r.snapshot.data)), r.snapshot.seq);
        for (const d of r.deltas) for (const fn of this.handlers.get("delta") ?? []) fn(JSON.parse(JSON.stringify(d.data)), d.seq);
        resolve(r.summary);
      }, 0);
    });
  }

  async leave(): Promise<unknown> {
    this.drop();
    return {};
  }

  private others(): FakeHub[] {
    return (this.r?.members ?? []).filter((m) => m !== this);
  }

  setState(data: unknown): void {
    const r = this.r;
    if (!r || r.summary.host !== this.you) return;
    r.snapshot = { seq: ++r.seq, data: JSON.parse(JSON.stringify(data)) };
    r.deltas = [];
    for (const m of this.others()) m.deliver("state", data, r.seq);
  }

  sendDelta(data: unknown): void {
    const r = this.r;
    if (!r || r.summary.host !== this.you) return;
    r.deltas.push({ seq: ++r.seq, data: JSON.parse(JSON.stringify(data)) });
    for (const m of this.others()) m.deliver("delta", data, r.seq);
  }

  send(data: unknown, to?: number): void {
    for (const m of this.others()) if (to === undefined || m.you === to) m.deliver("msg", data, this.you);
  }

  sendBinary(): void {}

  setRoom(changes: { name?: string; public?: boolean; meta?: unknown }): void {
    if (this.r && this.r.summary.host === this.you) Object.assign(this.r.summary, changes);
  }

  close(): void {
    this.drop();
    this.closed = true;
  }

  private drop(): void {
    const r = this.r;
    if (!r) return;
    r.members = r.members.filter((m) => m !== this);
    r.summary.players = r.members.length;
    for (const m of r.members) m.deliver("player-", this.you);
    if (r.summary.host === this.you && r.members.length > 0) {
      r.summary.host = Math.min(...r.members.map((m) => m.you));
      for (const m of r.members) m.deliver("host", r.summary.host);
    }
    this.r = null;
    this.room = null;
  }
}
