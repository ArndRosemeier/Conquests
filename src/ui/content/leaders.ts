import type { PowerId } from "../../engine/types.ts";

/**
 * The head of state or government each power is led by at the start of a
 * scenario. Portraits were painted with meta/muse-image
 * (scripts/assets/gen_leaders.sh). A game keeps its opening leaders throughout.
 */
export interface Leader {
  readonly name: string;
  readonly title: string;
  readonly portrait: string;
}

const BASE = import.meta.env.BASE_URL;
const art = (power: string, year: number): string => `${BASE}art/leader-${power}-${year}.webp`;

const LEADERS: Readonly<Record<string, readonly (Omit<Leader, "portrait"> & { readonly from: number })[]>> = {
  england: [
    { from: 1880, name: "Queen Victoria", title: "Queen of the United Kingdom" },
    { from: 1914, name: "H. H. Asquith", title: "Prime Minister" },
  ],
  germany: [
    { from: 1880, name: "Otto von Bismarck", title: "Imperial Chancellor" },
    { from: 1914, name: "Wilhelm II", title: "German Emperor" },
  ],
  france: [
    { from: 1880, name: "Jules Grévy", title: "President of the Republic" },
    { from: 1914, name: "Raymond Poincaré", title: "President of the Republic" },
  ],
  usa: [
    { from: 1880, name: "Rutherford B. Hayes", title: "President of the United States" },
    { from: 1914, name: "Woodrow Wilson", title: "President of the United States" },
  ],
  japan: [
    { from: 1880, name: "Emperor Meiji", title: "Emperor of Japan" },
    { from: 1914, name: "Emperor Taishō", title: "Emperor of Japan" },
  ],
  russia: [
    { from: 1880, name: "Alexander II", title: "Emperor of All the Russias" },
    { from: 1914, name: "Nicholas II", title: "Emperor of All the Russias" },
  ],
};

/** The leader of `power` in a game that started in `startYear`, or null for an unknown power. */
export function leaderOf(power: PowerId | string, startYear: number): Leader | null {
  const list = LEADERS[String(power)];
  if (list === undefined || list.length === 0) return null;
  const pick = [...list].reverse().find((l) => l.from <= startYear) ?? list[0]!;
  return { name: pick.name, title: pick.title, portrait: art(String(power), pick.from) };
}

/** Mood of a computer leader toward the player, from what the Diplomacy panel already knows. */
export interface MoodInput {
  readonly atWar: boolean;
  /** War balance from the leader's side (positive: the leader is winning). */
  readonly balance: number;
  readonly treaty: "pact" | "alliance" | null;
  readonly inCoalitionAgainstYou: boolean;
  readonly opinion: number;
}

/** One line the leader says to the player. */
export function leaderLine(m: MoodInput): string {
  if (m.inCoalitionAgainstYou) return "The world has seen what you are. We stand with the others.";
  if (m.atWar) {
    if (m.balance <= -15) return "This war has cost us both enough. We are ready to talk terms.";
    if (m.balance >= 15) return "Your armies are beaten. Ask for peace while you still can.";
    return "You chose war. You will find us ready.";
  }
  if (m.treaty === "alliance") return m.opinion >= 30 ? "Our alliance stands firm. Call, and we will come." : "We are allies. Do not give us reason to regret it.";
  if (m.treaty === "pact") return "Our pact is kept. See that you keep it too.";
  if (m.opinion >= 30) return "Our nations understand each other. Perhaps more than a handshake is in order.";
  if (m.opinion >= 0) return "We watch your progress with interest.";
  if (m.opinion >= -30) return "We have our doubts about your intentions.";
  return "We do not trust you, and we are not alone.";
}
