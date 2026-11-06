/**
 * The game's version and its "What's new" history.
 *
 * Every release merged to main adds ONE new entry at the top, 0.01 above the
 * previous one (1.00, 1.01, 1.02, ...). The version shown in the game is the
 * top entry, so the number and the notes can never disagree.
 * changelog.test.ts checks the steps.
 */
export interface Release {
  /** "1.00", "1.01", ... always two decimals. */
  readonly version: string;
  /** ISO date the release reached main. */
  readonly date: string;
  /** Short, player-facing lines. */
  readonly notes: readonly string[];
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "1.01",
    date: "2026-11-06",
    notes: [
      "Home advantage: defenders now fight at double strength, on land and at sea. Attacks need about twice the troops they used to.",
      "The rules reference, the odds calculator and the computer rivals all account for the home advantage.",
    ],
  },
  {
    version: "1.00",
    date: "2026-11-06",
    notes: [
      "Versions and this What's new page. Every release now raises the version by 0.01.",
      "Diplomacy: wars must be declared and cost reputation, wars end only by a peace treaty, and a two-year truce follows. Peace offers can carry a payment or ask for tribute.",
      "Computer rivals weigh honor and opportunism when they declare war, sue for peace or answer your offers.",
      "Optional globe view of the world map during play (Settings or the 🌐 button).",
      "The news no longer reports a won fleet sortie as a captured territory.",
      "The rules reference now shows every formula, the power constants and how battles are resolved.",
      "Toasts announce wars and peace between the other nations.",
      "All speech has been removed; the game uses music and sound effects only.",
      "The big renovation: an animated title screen, the World Herald newspaper, new art and audio, rule fixes from a full audit, and online multiplayer with invites.",
    ],
  },
];

export const VERSION: string = CHANGELOG[0]!.version;

const SEEN_KEY = "conquests.seenVersion";

/** True when the player has not opened What's new since this version arrived. */
export function hasUnseenNews(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== VERSION;
  } catch {
    return false;
  }
}

export function markNewsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    // Storage blocked: the dot just stays.
  }
}
