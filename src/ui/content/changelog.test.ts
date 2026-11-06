import { CHANGELOG, VERSION } from "./changelog.ts";

describe("changelog", () => {
  it("starts at 1.00 and rises by exactly 0.01 per release, newest first", () => {
    const hundredths = CHANGELOG.map((r) => {
      expect(r.version).toMatch(/^\d+\.\d\d$/);
      return Math.round(Number(r.version) * 100);
    });
    expect(hundredths[hundredths.length - 1]).toBe(100);
    for (let i = 1; i < hundredths.length; i++) expect(hundredths[i - 1]! - hundredths[i]!).toBe(1);
  });

  it("shows the newest entry as the version", () => {
    expect(VERSION).toBe(CHANGELOG[0]!.version);
  });

  it("has notes and a date for every release", () => {
    for (const r of CHANGELOG) {
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.date).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });
});
