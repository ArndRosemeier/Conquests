# Conquests: notes for contributors

## Versioning (required for every change merged to main)

The game shows its version (title screen, top bar, pause menu) and a "What's new" page.
Both come from `src/ui/content/changelog.ts`.

Every release merged to main adds ONE new entry at the top of `CHANGELOG`, exactly 0.01 above
the previous one (1.00, 1.01, 1.02, ...), with the date and a few short, player-facing notes.
Do not edit the version anywhere else. `changelog.test.ts` fails if a step is skipped.

If two branches pick the same number, the one merged second takes the next number.
