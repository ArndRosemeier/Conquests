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
    version: "1.11",
    date: "2026-11-07",
    notes: [
      "A thrown-back attack no longer reveals the defenders. Instead the attacker's old spy report is thrown away, so you (and computer rivals) must spy again to learn the real garrison.",
      "Computer rivals won't attack a power's country without a spy report, so after a failed attack they wait for fresh intel instead of attacking blindly.",
    ],
  },
  {
    version: "1.10",
    date: "2026-11-07",
    notes: [
      "An attack that is thrown back now reveals how many defenders are left, for you and for computer rivals.",
      "Computer rivals no longer keep hammering a country you reinforced: they learn from the failed attack, and in spring they spy again on old reports before attacking.",
    ],
  },
  {
    version: "1.09",
    date: "2026-11-07",
    notes: [
      "Quick step buttons (−50, −10, −1, +1, +10, +50) above the troop and fleet sliders when marching, sailing or buying. Troop steps count in thousands.",
    ],
  },
  {
    version: "1.08",
    date: "2026-11-06",
    notes: [
      "Computer rivals stop overbuilding navies. Their ships ferry an army over, sail home and carry the next one; new ships are bought only when the whole fleet is too small for an invasion.",
      "The money saved goes into troops: rival armies are now several times larger, so they defend and attack much harder.",
    ],
  },
  {
    version: "1.07",
    date: "2026-11-06",
    notes: [
      "Neutral countries are weaker: twice as many are barely defended, and most garrisons now sit near the low end of their range. Huge neutral armies are rare.",
    ],
  },
  {
    version: "1.06",
    date: "2026-11-06",
    notes: [
      "Troops now always come in whole thousands: garrisons, marches, landings, aid to minors and bribes.",
      "Battle results are rounded to the nearest 1,000, so losses and survivors read cleanly.",
      "Older saves are rounded to whole thousands when loaded.",
    ],
  },
  {
    version: "1.05",
    date: "2026-11-06",
    notes: [
      "Leaders: every nation now has its head of state, with a painted portrait, in the Diplomacy panel and on offers. They tell you what they think of you.",
      "Land in peace treaties: ask for border territories, or hand some over, along with money. Home supply centers can never be traded.",
      "Coalitions: once a power's reputation sinks below 25, others can band together against it. Joining raises your reputation; a separate peace costs it.",
      "Computer rivals demand land when they are winning, offer it when they are losing and broke, and gang up on powers that break their word.",
    ],
  },
  {
    version: "1.04",
    date: "2026-11-06",
    notes: [
      "Treaties: non-aggression pacts for 3 or 5 years, and alliances. Breaking a pact or betraying an ally costs dearly in reputation.",
      "Calls to arms: when your ally is attacked you must join the war or refuse. Joining raises your reputation, refusing ruins it and ends the alliance.",
      "War aid: ask another power to join your war, or accept its offer, for a price.",
      "The new Diplomacy panel (🕊 or D) shows where you stand with every power and what each computer rival thinks of you, and why.",
      "Computer rivals now propose pacts and alliances, answer calls to arms by their sense of honor, and charge for their help.",
    ],
  },
  {
    version: "1.03",
    date: "2026-11-06",
    notes: [
      "A new world map drawn from real country borders and coastlines.",
      "Paris holds the north French coast again and can build and sail fleets.",
      "Territories now match their real neighbours: Rupert's Land around Hudson Bay, Finland under Russia, Galicia under Austria-Hungary, Bolivia's 1880 coast.",
      "Greenland, New Zealand and the Arctic appear as unclaimed land.",
    ],
  },
  {
    version: "1.02",
    date: "2026-11-06",
    notes: [
      "Map or globe in one click: a new switch in the top bar, or press G.",
      "The flat map now wraps itself around the globe when you switch, and unrolls back into a map when you leave it.",
    ],
  },
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
