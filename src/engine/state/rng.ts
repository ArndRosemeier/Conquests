/**
 * Deterministic, serializable PRNG (mulberry32). The engine stays deterministic
 * so that combat is testable, games are replayable, and (later) networking can
 * verify state. The entire RNG state is a single uint32 that lives in GameState.
 */
export class Rng {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  public int(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error(`Rng.int requires a positive bound, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max] inclusive. */
  public range(min: number, max: number): number {
    if (max < min) {
      throw new Error(`Rng.range requires max >= min, got [${min}, ${max}]`);
    }
    return min + this.int(max - min + 1);
  }

  /** Serializable snapshot of the current state. */
  public snapshot(): number {
    return this.state >>> 0;
  }
}
