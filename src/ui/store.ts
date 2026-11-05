import { create } from "zustand";
import { createAI, DEFAULT_AI_VERSION } from "../controllers/ai/factory.ts";
import { BUILTIN_PERSONAS } from "../controllers/ai/persona.ts";
import type { Persona, PersonaKnobs } from "../controllers/ai/persona.ts";
import { HumanController } from "../controllers/humanController.ts";
import type { PlayerController } from "../controllers/types.ts";
import { GameRunner } from "../game/gameRunner.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import type { RuleSet } from "../engine/ruleset/types.ts";
import type { Action } from "../engine/state/actions.ts";
import type { GameEvent } from "../engine/state/events.ts";
import { calendarYear } from "../engine/state/gameState.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { isAtWar } from "../engine/state/helpers.ts";
import { Rng } from "../engine/state/rng.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { AreaId, PowerId, Season } from "../engine/types.ts";
import { IllegalActionError } from "../engine/types.ts";
import { CLASSIC_WORLD, getArea, neighborsOf } from "../engine/world/classic.ts";
import type { WorldDefinition } from "../engine/world/types.ts";
import { CLASSIC_HOME, getScenario } from "../engine/world/scenarios.ts";
import { sound } from "./audio/sound.ts";
import { ART, storyFor, TIPS } from "./content/herald.ts";
import type { Story } from "./content/herald.ts";
import { money, powerColor, powerName, troops as troopsLabel } from "./content/powers.ts";
import { pushAutosave, putManualSave } from "./persistence.ts";
import { OnlineRoom } from "../net/online.ts";
import type { Hub, Intent } from "../net/online.ts";
import type { GameSettings } from "../net/protocol.ts";
import { SeatController } from "../net/seatController.ts";
import { reduce } from "../engine/state/reducer.ts";

export interface NewGameConfig {
  readonly scenarioId: string;
  readonly humanPower: PowerId;
  readonly personaMode: "random" | "specific";
  readonly personaId: string | null;
  readonly personaPool: readonly Persona[];
  readonly winningScore: number;
  readonly seed: number;
}

/** Deal a persona to each AI power per the config (seeded, reproducible). */
function assignPersonas(config: NewGameConfig, aiPowers: readonly PowerId[]): Map<PowerId, PersonaKnobs> {
  const pool = config.personaPool;
  const out = new Map<PowerId, PersonaKnobs>();
  const fallback = pool[0]?.knobs;
  if (fallback === undefined) return out;
  if (config.personaMode === "specific") {
    const chosen = pool.find((p) => p.id === config.personaId)?.knobs ?? fallback;
    for (const p of aiPowers) out.set(p, chosen);
    return out;
  }
  const rng = new Rng((config.seed ^ 0x5f3759df) >>> 0);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  aiPowers.forEach((p, i) => out.set(p, shuffled[i % shuffled.length]!.knobs));
  return out;
}

export type Screen = "title" | "newgame" | "game" | "online";
/** local: everything runs here. host: this browser runs an online game. client: someone else hosts. */
export type Mode = "local" | "host" | "client";
export type MoveMode = "army" | "fleet";
export type Panel = "none" | "guide" | "settings" | "saves" | "menu";
export type AiSpeed = "relaxed" | "normal" | "fast";
/** How the world is shown in a game: the flat map or the turning globe. */
export type MapView = "flat" | "globe";

/** A visual effect for the map to play once. */
export type Fx =
  | { readonly id: number; readonly kind: "battle"; readonly area: AreaId; readonly from: readonly AreaId[]; readonly bySea: boolean; readonly won: boolean; readonly color: string; readonly delay: number }
  | { readonly id: number; readonly kind: "capture"; readonly area: AreaId; readonly color: string; readonly delay: number }
  | { readonly id: number; readonly kind: "coins"; readonly area: AreaId; readonly delay: number }
  | { readonly id: number; readonly kind: "spy"; readonly area: AreaId; readonly delay: number }
  | { readonly id: number; readonly kind: "build"; readonly area: AreaId; readonly delay: number };

export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly body?: string;
  readonly tone: "good" | "bad" | "info" | "war";
  readonly area?: AreaId;
}

export interface LogEntry {
  readonly id: number;
  readonly when: string;
  readonly text: string;
  readonly tone: "good" | "bad" | "info" | "war";
  readonly area?: AreaId;
}

export interface HeraldIssue {
  readonly year: number;
  readonly lead: Story;
  readonly more: readonly Story[];
  readonly income: number;
  readonly tip: string;
}

export interface Banner {
  readonly id: number;
  readonly season: Season;
  readonly year: number;
  readonly yours: boolean;
}

interface StoreState {
  readonly screen: Screen;
  readonly preset: PowerId | null;
  readonly ruleSet: RuleSet;
  readonly world: WorldDefinition;
  readonly gameState: GameState | null;
  readonly humanPower: PowerId | null;
  readonly log: readonly LogEntry[];
  readonly toasts: readonly Toast[];
  readonly fx: readonly Fx[];
  readonly herald: HeraldIssue | null;
  readonly banner: Banner | null;
  readonly selected: AreaId | null;
  readonly move: { readonly mode: MoveMode; readonly from: AreaId; readonly to: AreaId | null } | null;
  readonly focus: { readonly area: AreaId; readonly n: number } | null;
  readonly panel: Panel;
  readonly aiSpeed: AiSpeed;
  readonly mapView: MapView;
  readonly canUndo: boolean;
  readonly spectating: boolean;
  readonly mode: Mode;

  goTitle: () => void;
  goNewGame: (preset?: PowerId | null) => void;
  startGame: (config: NewGameConfig) => void;
  loadGame: (state: GameState) => void;
  saveGame: (name: string) => Promise<void>;
  play: (action: Action) => boolean;
  undo: () => void;
  endTurn: () => void;
  select: (area: AreaId | null) => void;
  clickArea: (area: AreaId) => void;
  beginMove: (mode: MoveMode) => void;
  cancelMove: () => void;
  focusArea: (area: AreaId) => void;
  dismissToast: (id: number) => void;
  closeHerald: () => void;
  setPanel: (panel: Panel) => void;
  setAiSpeed: (speed: AiSpeed) => void;
  setMapView: (view: MapView) => void;
  consumeFx: (ids: readonly number[]) => void;
  spectate: () => void;
  goOnline: () => void;
  /** Open an online room (we host). */
  hostOnline: (name: string, settings: GameSettings, power: PowerId) => Promise<void>;
  joinOnline: (name: string, code: string) => Promise<void>;
  /** Host: start the online game with the seats claimed so far. */
  startOnline: () => void;
}

let runner: GameRunner | null = null;
let human: HumanController | null = null;
let net: OnlineRoom | null = null;
let seats = new Map<string, SeatController>();

const netListeners = new Set<() => void>();
let netVersion = 0;
const emitNet = (): void => {
  netVersion += 1;
  for (const fn of netListeners) fn();
};

/** The online room this browser is in, if any (for the lobby UI). */
export const getNet = (): OnlineRoom | null => net;
/** For useSyncExternalStore: changes whenever the room or its contents change. */
export const subscribeNet = (fn: () => void): (() => void) => {
  netListeners.add(fn);
  return () => netListeners.delete(fn);
};
export const netSnapshot = (): number => netVersion;
let undoStack: GameState[] = [];
let seq = 1;
const nextId = (): number => (seq += 1);

const PACING: Record<AiSpeed, { ai: number; combat: number }> = {
  relaxed: { ai: 320, combat: 2200 },
  normal: { ai: 150, combat: 1500 },
  fast: { ai: 25, combat: 700 },
};

const SPEED_KEY = "conquests.aiSpeed";
function loadSpeed(): AiSpeed {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    if (v === "relaxed" || v === "normal" || v === "fast") return v;
  } catch {
    /* default */
  }
  return "normal";
}

const VIEW_KEY = "conquests.mapView";
function loadView(): MapView {
  try {
    return localStorage.getItem(VIEW_KEY) === "globe" ? "globe" : "flat";
  } catch {
    return "flat";
  }
}

const MAX_LOG = 80;
const CLEARED = { selected: null, move: null } as const;

export const useGame = create<StoreState>((set, get) => {
  let autosaveKey: string | null = null;
  let stories: Story[] = [];
  let incomeThisYear = 0;
  let lastBannerKey = "";
  let lastTurnCall = "";

  const toast = (t: Omit<Toast, "id">): void => {
    const item = { ...t, id: nextId() };
    set((s) => ({ toasts: [...s.toasts, item].slice(-5) }));
    window.setTimeout(() => get().dismissToast(item.id), t.tone === "war" ? 7000 : 4800);
  };

  const logLine = (gs: GameState, text: string, tone: LogEntry["tone"], area?: AreaId): void => {
    const entry: LogEntry = {
      id: nextId(),
      when: `${gs.season.slice(0, 2)} ${calendarYear(gs)}`,
      text,
      tone,
      ...(area !== undefined ? { area } : {}),
    };
    set((s) => ({ log: [entry, ...s.log].slice(0, MAX_LOG) }));
  };

  const maybeAutosave = (gs: GameState, me: PowerId | null): void => {
    if (me === null || get().mode !== "local") return;
    if (gs.stage === "PLAYER" && gs.activePower === me) {
      const key = `${gs.year}-${gs.season}`;
      if (key !== autosaveKey) {
        autosaveKey = key;
        void pushAutosave(gs).catch((e) => console.error("Autosave failed", e));
      }
    }
  };

  /** Turn engine events into sounds, map effects, toasts, log lines and newspaper stories. */
  const digest = (gs: GameState, events: readonly GameEvent[]): void => {
    const { ruleSet, world, humanPower: me } = get();
    const pn = (id: PowerId | null): string => powerName(ruleSet.powers, id);
    const fx: Fx[] = [];
    let delay = 0;
    let battles = 0;
    for (const e of events) {
      const seed = `${gs.tick}-${e.type}-${"area" in e ? String(e.area) : ""}`;
      const story = storyFor(e, ruleSet, world, seed, me);
      if (story) stories.push(story);
      switch (e.type) {
        case "BATTLE": {
          const color = powerColor(ruleSet.powers, e.attacker);
          fx.push({ id: nextId(), kind: "battle", area: e.area, from: e.from, bySea: e.bySea, won: e.attackerWon, color, delay });
          delay += 380;
          battles += 1;
          const area = getArea(world, e.area).name;
          if (e.attacker === me) {
            const text = e.attackerWon
              ? `Your forces took ${area}`
              : `Your attack on ${area} was repelled`;
            logLine(gs, `${text} (lost ${troopsLabel(e.attackerLosses)})`, e.attackerWon ? "good" : "bad", e.area);
            toast({ title: text, body: `Losses: ${troopsLabel(e.attackerLosses)} · Enemy: ${troopsLabel(e.defenderLosses)}`, tone: e.attackerWon ? "good" : "bad", area: e.area });
          } else if (e.defender === me) {
            const text = e.attackerWon ? `${pn(e.attacker)} captured ${area}` : `${area} held against ${pn(e.attacker)}`;
            logLine(gs, text, e.attackerWon ? "bad" : "good", e.area);
            toast({ title: text, tone: e.attackerWon ? "bad" : "good", area: e.area });
          } else if (e.attackerWon) {
            logLine(gs, `${pn(e.attacker)} took ${area}${e.defender ? ` from ${pn(e.defender)}` : ""}`, "info", e.area);
          }
          break;
        }
        case "CONTROL_CHANGE":
          if (e.to !== null) fx.push({ id: nextId(), kind: "capture", area: e.area, color: powerColor(ruleSet.powers, e.to), delay: Math.max(0, delay - 120) });
          break;
        case "WAR_DECLARED":
          if (e.by === me || e.against === me) {
            const other = e.by === me ? e.against : e.by;
            toast({ title: `War with ${pn(other)}!`, body: e.by === me ? "Your attack started a war." : `${pn(e.by)} attacked you.`, tone: "war" });
            sound.play("drums", 0.8);
          } else {
            // Wars between other nations change the map too: tell the player.
            toast({ title: `${pn(e.by)} declares war on ${pn(e.against)}`, tone: "war" });
            sound.play("drums", 0.5);
          }
          logLine(gs, `${pn(e.by)} attacked ${pn(e.against)}: war`, "war");
          break;
        case "WAR_ENDED":
          logLine(gs, `${pn(e.by)} bought peace with ${pn(e.against)}`, "info");
          if (e.by === me || e.against === me) toast({ title: "Peace!", body: `The war between ${pn(e.by)} and ${pn(e.against)} is over.`, tone: "good" });
          else toast({ title: `${pn(e.by)} and ${pn(e.against)} make peace`, body: `${pn(e.by)} paid for the peace.`, tone: "info" });
          break;
        case "PEACE_LOAN_FAILED":
          if (e.by === me) toast({ title: "Peace offer refused", body: `${pn(e.target)} kept the money and the war.`, tone: "bad" });
          break;
        case "SUBVERSION":
          if (e.by === me) {
            const area = getArea(world, e.area).name;
            if (e.coup) {
              toast({ title: `${area} joins you!`, body: "Your agents' bribes paid off.", tone: "good", area: e.area });
              logLine(gs, `Coup: ${area} joined you`, "good", e.area);
              sound.play("crowd");
            } else {
              toast({ title: `Bribed officials in ${area}`, body: `${troopsLabel(e.troopsRemoved)} soldiers went home.`, tone: "info", area: e.area });
              sound.play("coins");
            }
            fx.push({ id: nextId(), kind: "coins", area: e.area, delay: 0 });
          }
          break;
        case "SPY_RESULT":
          if (e.by === me) {
            sound.play("telegraph");
            fx.push({ id: nextId(), kind: "spy", area: e.area, delay: 0 });
            toast({ title: `Report from ${getArea(world, e.area).name}`, body: `${e.troops.toLocaleString()} troops · income ${money(e.income)}`, tone: "info", area: e.area });
          }
          break;
        case "INCOME":
          if (e.power === me) {
            incomeThisYear = e.amount;
            sound.play("coins");
          }
          break;
        case "POWER_ELIMINATED":
          logLine(gs, `${pn(e.power)} has been eliminated`, e.power === me ? "bad" : "war");
          toast({ title: `${pn(e.power)} is out of the game`, tone: e.power === me ? "bad" : "war" });
          break;
        case "GAME_WON":
          sound.setMood(e.power === me ? "victory" : "defeat");
          break;
      }
    }
    if (battles > 0) {
      const naval = events.some((e) => e.type === "BATTLE" && e.bySea);
      sound.play(naval ? "naval" : "battle", 0.8);
      window.setTimeout(() => sound.play("cannon", 0.7), 350);
    }
    if (fx.length > 0) set((s) => ({ fx: [...s.fx, ...fx] }));
  };

  /** React to the state moving on: season banners, the yearly newspaper, music. */
  const onState = (gs: GameState): void => {
    const me = get().humanPower;
    // Online, ring a bell when it is the player's turn: they may have been looking elsewhere.
    if (get().mode !== "local" && me !== null && gs.stage === "PLAYER" && gs.activePower === me && gs.winner === null) {
      const key = `${gs.year}-${gs.season}`;
      if (key !== lastTurnCall) {
        lastTurnCall = key;
        sound.play("bell", 0.7);
      }
    }
    const bannerKey = `${gs.year}-${gs.season}`;
    if (gs.stage === "PLAYER" && bannerKey !== lastBannerKey && gs.winner === null) {
      lastBannerKey = bannerKey;
      if (gs.season === "SPRING" && gs.year > 1 && stories.length > 0) {
        publishHerald(gs);
      }
      set({ banner: { id: nextId(), season: gs.season, year: calendarYear(gs), yours: gs.activePower === me } });
      if (gs.season === "SPRING") sound.play("bell", 0.6);
    }
    if (me !== null && gs.winner === null) {
      const atWar = Object.values(gs.powers).some((p) => p.id !== me && !p.eliminated && isAtWar(gs, me, p.id));
      sound.setMood(atWar ? "war" : "campaign");
    }
    if (me !== null && gs.powers[String(me)]?.eliminated && !get().spectating && gs.winner === null) {
      sound.setMood("defeat");
    }
  };

  const publishHerald = (gs: GameState): void => {
    const sorted = [...stories].sort((a, b) => b.weight - a.weight);
    stories = [];
    const lead = sorted[0];
    if (!lead) return;
    const seen = new Set<string>([lead.headline]);
    const more = sorted.slice(1).filter((s) => !seen.has(s.headline) && seen.add(s.headline)).slice(0, 5);
    const tip = TIPS[(gs.year * 7) % TIPS.length]!;
    set({ herald: { year: calendarYear(gs) - 1, lead, more, income: incomeThisYear, tip } });
    sound.play("drums", 0.5);
  };

  /** Host: a seated player in another browser wants something. */
  const onIntent = (power: string, intent: Intent, from: number): void => {
    const gs = runner?.state;
    if (!runner || !gs || gs.stage !== "PLAYER" || String(gs.activePower) !== power) return;
    const seat = seats.get(power);
    if (!seat?.isWaiting) return;
    if (intent.k === "end") {
      undoStack = [];
      seat.finishTurn();
    } else if (intent.k === "undo") {
      const prev = undoStack.pop();
      if (prev !== undefined) runner.replace(prev);
    } else {
      const before = undoStack;
      undoStack = intent.action.type === "SPY" || intent.action.type === "SUBVERT" ? [] : [...undoStack, gs];
      try {
        runner.apply(intent.action);
      } catch (e) {
        undoStack = before;
        net?.refuse(from, e instanceof Error ? e.message : String(e));
      }
    }
  };

  const openNet = (name: string): void => {
    net?.close();
    // Development: tests can hand in an in-memory hub (see src/net/fakeHub.ts).
    const devHub = import.meta.env.DEV ? (window as unknown as { conquestsHub?: (name: string) => Hub }).conquestsHub?.(name) : undefined;
    const room = new OnlineRoom(devHub ? { name, hub: devHub } : { name });
    net = room;
    room.subscribe(emitNet);
    emitNet();
    room.onNotice = (text) => toast({ title: text, tone: "info" });
    room.onIntent = onIntent;
    room.onSeatsChanged = () => {
      for (const seat of seats.values()) void seat.takeOver();
    };
    room.onGame = (gs, events, fresh) => {
      if (net !== room || room.isHost) return;
      if (fresh || get().screen !== "game") {
        launchClient(gs);
        return;
      }
      const prev = get().gameState;
      set({ gameState: gs, canUndo: room.room?.undo === room.seat && room.seat !== null });
      if (prev !== null && (prev.activePower !== gs.activePower || prev.stage !== gs.stage)) set({ ...CLEARED });
      if (events.length > 0) digest(gs, events);
      onState(gs);
    };
    room.onBecomeHost = () => {
      if (net !== room || !room.game || room.room?.phase !== "playing") return;
      launch(room.game, "host", get().screen === "game");
    };
  };

  /** Client: show a game someone else hosts. */
  const launchClient = (gs: GameState): void => {
    runner?.stop();
    runner = null;
    human = null;
    stories = [];
    lastBannerKey = "";
    const me = net?.seat ?? null;
    const humanPower = me === null ? null : (Object.values(gs.powers).find((p) => String(p.id) === me)?.id ?? null);
    const home = humanPower === null ? undefined : Object.values(gs.areas).find((a) => a.supplyCenterOf === humanPower && a.owner === humanPower);
    set({
      screen: "game",
      mode: "client",
      gameState: gs,
      humanPower,
      focus: home === undefined ? null : { area: home.id, n: Date.now() },
      log: [],
      toasts: [],
      fx: [],
      herald: null,
      banner: null,
      panel: "none",
      canUndo: false,
      spectating: humanPower === null,
      ...CLEARED,
    });
    onState(gs);
    sound.setMood("campaign");
  };

  const launch = (state: GameState, mode: Mode = "local", keepUi = false): void => {
    runner?.stop();
    runner = null;
    undoStack = [];
    seats = new Map();
    if (!keepUi) {
      stories = [];
      incomeThisYear = 0;
      lastBannerKey = "";
    }
    const controllers = new Map<PowerId, PlayerController>();
    let humanPower: PowerId | null = null;
    human = null;
    const mySeat = net?.seat ?? null;
    for (const p of Object.values(state.powers)) {
      if (mode !== "local") {
        if (p.control === "human" && String(p.id) === mySeat) {
          human = new HumanController();
          controllers.set(p.id, human);
          humanPower = p.id;
        } else if (p.control === "human") {
          const ai = createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD);
          const ctl = new SeatController(() => net?.seatOnline(String(p.id)) ?? false, ai, () => runner?.state ?? state);
          seats.set(String(p.id), ctl);
          controllers.set(p.id, ctl);
        } else if (p.control === "ai") {
          controllers.set(p.id, createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD));
        }
        continue;
      }
      if (p.control === "human") {
        human ??= new HumanController();
        controllers.set(p.id, human);
        humanPower = p.id;
      } else if (p.control === "ai") {
        controllers.set(p.id, createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD));
      }
    }
    // Open the map over the player's home rather than the whole world.
    const home = humanPower === null ? undefined : Object.values(state.areas).find((a) => a.supplyCenterOf === humanPower && a.owner === humanPower);
    if (keepUi) {
      set({ screen: "game", gameState: state, humanPower, mode, canUndo: false });
    } else set({
      screen: "game",
      mode,
      gameState: state,
      humanPower,
      focus: home === undefined ? null : { area: home.id, n: Date.now() },
      log: [],
      toasts: [],
      fx: [],
      herald: null,
      banner: null,
      panel: "none",
      canUndo: false,
      spectating: false,
      ...CLEARED,
    });
    const pace = PACING[get().aiSpeed];
    runner = new GameRunner(CLASSIC_RULESET, CLASSIC_WORLD, state, controllers, {
      aiActionDelayMs: pace.ai,
      combatDelayMs: pace.combat,
      onUpdate: (s, events) => {
        const prev = get().gameState;
        if (prev !== null && (prev.activePower !== s.activePower || prev.stage !== s.stage)) {
          undoStack = [];
          set({ canUndo: false });
        }
        set({ gameState: s });
        if (events.length > 0) digest(s, events);
        onState(s);
        maybeAutosave(s, get().humanPower);
        if (mode === "host") net?.publish(s, events, undoStack.length > 0 && s.activePower !== null ? String(s.activePower) : null);
      },
    });
    onState(state);
    maybeAutosave(state, humanPower);
    if (!keepUi) sound.setMood("campaign");
    void runner.run().catch((e) => {
      console.error(e);
      toast({ title: "The game engine stopped", body: String(e instanceof Error ? e.message : e), tone: "bad" });
    });
  };

  return {
    screen: "title",
    preset: null,
    ruleSet: CLASSIC_RULESET,
    world: CLASSIC_WORLD,
    gameState: null,
    humanPower: null,
    log: [],
    toasts: [],
    fx: [],
    herald: null,
    banner: null,
    selected: null,
    move: null,
    focus: null,
    panel: "none",
    aiSpeed: loadSpeed(),
    mapView: loadView(),
    canUndo: false,
    spectating: false,
    mode: "local",

    goTitle: () => {
      net?.close();
      net = null;
      emitNet();
      runner?.stop();
      runner = null;
      human = null;
      set({ screen: "title", gameState: null, humanPower: null, panel: "none", herald: null, ...CLEARED });
      sound.setMood("title");
    },

    goNewGame: (preset = null) => set({ screen: "newgame", preset, panel: "none" }),

    startGame: (config) => {
      const ruleSet = CLASSIC_RULESET;
      const scenario = getScenario(config.scenarioId);
      const aiPowers = ruleSet.playOrder.filter((p) => p !== config.humanPower);
      const personas = assignPersonas(config, aiPowers);
      const controls = new Map<PowerId, PowerControlConfig>();
      for (const power of ruleSet.playOrder) {
        controls.set(
          power,
          power === config.humanPower
            ? { control: "human", persona: null }
            : { control: "ai", persona: personas.get(power) ?? null },
        );
      }
      const initial = createGame({
        ruleSet,
        world: CLASSIC_WORLD,
        home: CLASSIC_HOME,
        scenario,
        controls,
        winningScore: config.winningScore,
        seed: config.seed,
      });
      autosaveKey = null;
      launch(initial);
    },

    loadGame: (state) => {
      autosaveKey = `${state.year}-${state.season}`;
      launch(state);
    },

    saveGame: async (name) => {
      const { gameState } = get();
      if (gameState !== null) await putManualSave(name, gameState);
    },

    play: (action) => {
      const { gameState, mode } = get();
      if (gameState === null) return false;
      if (mode === "client") {
        // Check locally for an instant answer; the host applies it for real.
        try {
          reduce(gameState, action, CLASSIC_RULESET, CLASSIC_WORLD);
        } catch (e) {
          toast({ title: "Not possible", body: e instanceof Error ? e.message : String(e), tone: "bad" });
          return false;
        }
        net?.act(action);
      } else {
        if (runner === null) return false;
        // Spying and bribing reveal or roll something, so they cannot be taken back.
        const before = undoStack;
        undoStack = action.type === "SPY" || action.type === "SUBVERT" ? [] : [...undoStack, gameState];
        try {
          runner.apply(action);
        } catch (e) {
          undoStack = before;
          const msg = e instanceof IllegalActionError ? e.message : String(e);
          toast({ title: "Not possible", body: msg, tone: "bad" });
          return false;
        }
        set({ canUndo: undoStack.length > 0 });
      }
      const area = "area" in action ? action.area : "to" in action ? action.to : null;
      switch (action.type) {
        case "BUILD_ARMY":
          sound.play("drums", 0.6);
          if (area !== null) set((s) => ({ fx: [...s.fx, { id: nextId(), kind: "build", area, delay: 0 }] }));
          break;
        case "BUILD_FLEET":
          sound.play("build", 0.7);
          if (area !== null) set((s) => ({ fx: [...s.fx, { id: nextId(), kind: "build", area, delay: 0 }] }));
          break;
        case "FORTIFY":
          sound.play("build", 0.7);
          break;
        case "MOVE_ARMY":
          sound.play("drums", 0.5);
          break;
        case "MOVE_FLEET":
          sound.play("horn", 0.6);
          break;
        case "LOAN_MINOR":
        case "LOAN_POWER":
          sound.play("coins");
          break;
        default:
          sound.play("stamp", 0.6);
      }
      return true;
    },

    undo: () => {
      if (get().mode === "client") {
        net?.undo();
        sound.play("click");
        set({ ...CLEARED });
        return;
      }
      const prev = undoStack.pop();
      if (prev === undefined || runner === null) return;
      runner.replace(prev);
      sound.play("click");
      set({ canUndo: undoStack.length > 0, ...CLEARED });
    },

    endTurn: () => {
      if (get().mode === "client") {
        net?.endTurn();
        sound.play("stamp", 0.7);
        set({ canUndo: false, ...CLEARED });
        return;
      }
      undoStack = [];
      sound.play("stamp", 0.7);
      human?.finishTurn();
      set({ canUndo: false, ...CLEARED });
    },

    select: (area) => set({ selected: area, move: null }),

    clickArea: (area) => {
      const { move, world, gameState, humanPower } = get();
      sound.play("click", 0.5);
      if (move !== null && gameState !== null && gameState.activePower === humanPower) {
        if (area === move.from) {
          set({ move: null, selected: area });
          return;
        }
        const valid = move.mode === "army" ? neighborsOf(world, move.from).includes(area) : getArea(world, area).isPort;
        if (valid) {
          set({ move: { ...move, to: area } });
          return;
        }
      }
      set({ selected: area, move: null });
    },

    beginMove: (mode) => {
      const { selected } = get();
      if (selected === null) return;
      set({ move: { mode, from: selected, to: null } });
    },

    cancelMove: () => set((s) => ({ move: null, selected: s.move?.from ?? s.selected })),

    focusArea: (area) => set((s) => ({ focus: { area, n: (s.focus?.n ?? 0) + 1 }, selected: area, move: null })),

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    closeHerald: () => set({ herald: null }),

    setPanel: (panel) => set({ panel }),

    setAiSpeed: (speed) => {
      try {
        localStorage.setItem(SPEED_KEY, speed);
      } catch {
        /* not persisted */
      }
      const pace = PACING[speed];
      runner?.setPacing(pace.ai, pace.combat);
      set({ aiSpeed: speed });
    },

    setMapView: (view) => {
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        /* not persisted */
      }
      set({ mapView: view });
    },

    consumeFx: (ids) => set((s) => ({ fx: s.fx.filter((f) => !ids.includes(f.id)) })),

    spectate: () => set({ spectating: true }),

    goOnline: () => set({ screen: "online", panel: "none" }),

    hostOnline: async (name, settings, power) => {
      openNet(name);
      await net!.host(settings, String(power));
    },

    joinOnline: async (name, code) => {
      openNet(name);
      await net!.join(code);
    },

    startOnline: () => {
      const room = net?.room;
      if (!net || !net.isHost || !room || room.phase !== "lobby") return;
      const ruleSet = CLASSIC_RULESET;
      const controls = new Map<PowerId, PowerControlConfig>();
      const pool = BUILTIN_PERSONAS;
      ruleSet.playOrder.forEach((power, i) => {
        controls.set(
          power,
          room.seats[String(power)] !== undefined
            ? { control: "human", persona: null }
            : { control: "ai", persona: pool[(i + room.settings.seed) % pool.length]!.knobs },
        );
      });
      const initial = createGame({
        ruleSet,
        world: CLASSIC_WORLD,
        home: CLASSIC_HOME,
        scenario: getScenario(room.settings.scenarioId),
        controls,
        winningScore: room.settings.winningScore,
        seed: room.settings.seed,
      });
      net.start(initial);
      launch(initial, "host");
    },
  };
});

export { ART };

// Handy for poking at the game from the browser console while developing.
if (import.meta.env.DEV) (window as unknown as { conquests: typeof useGame }).conquests = useGame;
