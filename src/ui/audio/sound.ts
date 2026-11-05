/**
 * Music, sound effects and the herald's voice. Music streams through one
 * <audio> element per mood (cross-faded); effects and voice lines are short
 * clips played through cached elements. Browsers block sound until the first
 * user gesture, so nothing plays before `unlock()` has run once.
 */

export type Mood = "title" | "campaign" | "war" | "victory" | "defeat" | "none";
export type Sfx =
  | "cannon"
  | "battle"
  | "naval"
  | "horn"
  | "coins"
  | "stamp"
  | "telegraph"
  | "crowd"
  | "drums"
  | "fanfare"
  | "bell"
  | "click"
  | "build";
export type Voice = "welcome" | "yourturn" | "war" | "victory" | "defeat" | "newyear";

export interface AudioSettings {
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
}

const KEY = "conquests.audio";
const DEFAULTS: AudioSettings = { music: 0.55, sfx: 0.7, voice: 0.8, muted: false };

const BASE = import.meta.env.BASE_URL;
const MUSIC: Record<Exclude<Mood, "none">, readonly string[]> = {
  title: ["audio/music/title.mp3"],
  campaign: ["audio/music/campaign-1.mp3", "audio/music/campaign-2.mp3"],
  war: ["audio/music/war.mp3"],
  victory: ["audio/music/victory.mp3"],
  defeat: ["audio/music/defeat.mp3"],
};
/** Moods that play once instead of looping. */
const ONE_SHOT: ReadonlySet<Mood> = new Set(["victory", "defeat"]);

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    /* storage blocked: defaults */
  }
  return { ...DEFAULTS };
}

class SoundSystem {
  settings: AudioSettings = load();
  private unlocked = false;
  private mood: Mood = "none";
  private track: HTMLAudioElement | null = null;
  private trackIndex = 0;
  private pool = new Map<string, HTMLAudioElement[]>();
  private listeners = new Set<() => void>();
  private lastPlayed = new Map<string, number>();

  /** Call from any user gesture; starts the pending mood's music. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const want = this.mood;
    this.mood = "none";
    this.setMood(want);
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* not persisted */
    }
    if (this.track) this.track.volume = this.musicVolume();
    for (const fn of this.listeners) fn();
  }

  private musicVolume(): number {
    return this.settings.muted ? 0 : this.settings.music * 0.6;
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.unlocked) return;
    const old = this.track;
    this.track = null;
    if (old) this.fadeOut(old);
    if (mood === "none") return;
    const list = MUSIC[mood];
    this.trackIndex = Math.floor(Math.random() * list.length);
    this.startTrack(mood, list);
  }

  private startTrack(mood: Mood, list: readonly string[]): void {
    const el = new Audio(BASE + list[this.trackIndex % list.length]!);
    el.preload = "auto";
    el.volume = 0;
    el.loop = list.length === 1 && !ONE_SHOT.has(mood);
    el.addEventListener("ended", () => {
      if (this.track !== el || ONE_SHOT.has(mood)) return;
      this.trackIndex += 1;
      this.startTrack(mood, list);
    });
    this.track = el;
    void el.play().catch(() => {
      /* autoplay refused; the next gesture retries via unlock */
    });
    this.fadeIn(el);
  }

  private fadeIn(el: HTMLAudioElement): void {
    const target = (): number => this.musicVolume();
    const step = (): void => {
      if (this.track !== el) return;
      el.volume = Math.min(target(), el.volume + 0.04);
      if (el.volume < target()) window.setTimeout(step, 60);
    };
    step();
  }

  private fadeOut(el: HTMLAudioElement): void {
    const step = (): void => {
      el.volume = Math.max(0, el.volume - 0.05);
      if (el.volume > 0) window.setTimeout(step, 50);
      else el.pause();
    };
    step();
  }

  private clip(path: string, volume: number, minGapMs = 60): void {
    if (!this.unlocked || this.settings.muted || volume <= 0) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(path) ?? 0) < minGapMs) return;
    this.lastPlayed.set(path, now);
    const list = this.pool.get(path) ?? [];
    this.pool.set(path, list);
    let el = list.find((a) => a.paused || a.ended);
    if (!el) {
      if (list.length >= 4) return;
      el = new Audio(BASE + path);
      list.push(el);
    }
    el.volume = Math.min(1, volume);
    el.currentTime = 0;
    void el.play().catch(() => {});
  }

  play(effect: Sfx, gain = 1): void {
    this.clip(`audio/sfx/${effect}.mp3`, this.settings.sfx * gain, effect === "click" ? 40 : 120);
  }

  say(line: Voice): void {
    this.clip(`audio/vo/${line}.mp3`, this.settings.voice, 1500);
  }
}

export const sound = new SoundSystem();

// The first click or key anywhere unlocks audio.
if (typeof window !== "undefined") {
  const unlock = (): void => sound.unlock();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}
