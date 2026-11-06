import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { leaderLine, leaderOf } from "./leaders.ts";

describe("leaders", () => {
  it("every power has a leader and portrait for both scenario years", () => {
    for (const p of ["england", "germany", "france", "usa", "japan", "russia"]) {
      for (const year of [1880, 1914]) {
        const l = leaderOf(p, year)!;
        expect(l.name.length).toBeGreaterThan(0);
        const file = l.portrait.replace(/^.*art\//, "public/art/");
        expect(existsSync(file), file).toBe(true);
      }
    }
    expect(leaderOf("germany", 1900)!.name).toBe("Otto von Bismarck");
    expect(leaderOf("germany", 1914)!.name).toBe("Wilhelm II");
  });

  it("speaks from the war situation first", () => {
    expect(leaderLine({ atWar: true, balance: -20, treaty: null, inCoalitionAgainstYou: false, opinion: -50 })).toMatch(/terms/);
    expect(leaderLine({ atWar: false, balance: 0, treaty: "pact", inCoalitionAgainstYou: false, opinion: 10 })).toMatch(/pact/);
  });
});
