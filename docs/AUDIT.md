# Conquests audit (November 2026)

What I found when going through the game before the renovation, and what happened to each finding.
"Fixed" items are in the rules PR; UI items are handled by the UI renovation PR.

## Rules and engine

| # | Finding | Effect in play | Status |
|---|---|---|---|
| 1 | Two armies of the same power marching into the same area fought **one after the other**, and a second wave that arrived after its own side had taken the area **fought its own garrison** (it was still classified as an attack). | Attacking from two sides was weaker than one big stack; a follow-up wave could replace the garrison with its own survivors or "lose" to itself, and booked +1/-1 battle points against itself. | Fixed: a power's land moves on one target fight as one combined force, and ownership is re-checked before every assault. |
| 2 | `WAR_DECLARED` named the **defender** as the one declaring war. | The chronicle read "France declares war on Germany" when Germany attacked France. | Fixed: the attacker is `by`. |
| 3 | Powers were never eliminated (`eliminated` was declared but never set). | A power with no land kept taking empty turns forever; a lone survivor did not win. | Fixed: landless powers are eliminated (with an event), skipped in turn order, and the last power standing wins. |
| 4 | The "no score limit" option was stored as `Infinity`, which JSON turns into `null`. | Saves and anything sent over the network silently changed the setting. | Fixed: 0 means no limit; old saves migrate. |
| 5 | The calendar never matched the scenario: every game started in "SPRING 1", while scenarios are called 1880 and 1914. | Confusing dates throughout. | Fixed: scenarios carry a start year; `calendarYear()` gives 1880, 1914, ... |
| 6 | The between-turns logic (combat, new season, income, winner check) was copied into the game runner, the simulator and the tests. | Three places to keep in sync; easy to drift (the winner check already differed). | Fixed: one `advanceAfterCombat()` used everywhere, including the coming multiplayer host. |
| 7 | Small holes in action validation: spying on your own area, zero or negative loans, sailing a fleet to the port it is in. | Wasted money or nonsense moves were accepted. | Fixed, with tests. |
| 8 | Economic aid to a minor used a hard-coded `amount / 30`. | A balance number hidden in logic. | Moved into the ruleset (`minorTroopsPerDollar`). |
| 9 | A repelled naval landing reported the troops as lost even when they sailed home. | Wrong numbers in the battle report. | Fixed. |
| 10 | The first active power was always `playOrder[0]`, even if that power was not played by anyone. | Would hang a game where England is unplayed. | Fixed. |
| 11 | Code comments contradicted the code (for example "starting areas give no victory points" right above code that gives them points). | Misleading for whoever tunes the game. | Fixed. |

## Balance (measured with the new `npm run balance`, 60 all-AI games each)

Before the renovation the **USA won 87%** of open-world games (52 of 60), with England, Germany and Russia
never winning. Cause: the Americas hold more weak independent states within marching distance of one
power than any other continent, and nobody else can reach them by land.

After giving neutral countries in the Americas tougher garrisons (a data-driven `minorStrength` per
scenario):

| Scenario | England | Germany | France | USA | Japan | Russia |
|---|---|---|---|---|---|---|
| Open World, before | 0% | 0% | 10% | **87%** | 3% | 0% |
| Open World, after | 0% | 0% | 32% | 38% | 30% | 0% |
| 1880, after | 0% | 0% | 45% | 45% | 10% | 0% |
| 1914, after | 3% | 8% | 17% | 65% | 0% | 7% |

Still open: the computer is weak at invading overseas and at defending its homeland, which hurts island
England and squeezed Germany most. That is AI work rather than a rules bug. The UI now tells players how
hard each nation is to play, so the asymmetry is visible instead of hidden.

## Branding

The game presented itself as a "faithful remake" of a commercial 1985 game, used that game's name in the
title bar, package name, deploy metadata and README, and cited its manual's section numbers in code.
It is now **Conquests**, an original game in the same genre: its own name, art, music and text.

## UI and experience (handled in the renovation PR)

- There is no title screen: the game opens on a plain settings form.
- Neutral countries are drawn in random dark colours from the same palette family as the six powers,
  so a glance cannot tell "unclaimed" from "owned by a rival".
- After combat there is no report: results only appear as one-line entries in a 40-line log.
- Nothing explains the rules in the game itself (a "Combat Info" dialog only).
- No sound, no music, no animation of moves or battles.
- Scores are shown clamped to 0 while the engine keeps negative scores, so the standings could disagree
  with who actually leads.
- A developer tool (the persona crash tester) is reachable from the player's setup screen.
- The setup lets you type a random seed but does not explain it.
- Two AI versions ship in the bundle while only one plays (the other is kept for A/B tests).
