import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { effectiveness } from "../../engine/state/combat.ts";
import { estimateBattle } from "../../engine/state/combatSim.ts";
import type { BattleScenario } from "../../engine/state/combatSim.ts";
import type { PowerId } from "../../engine/types.ts";
import { TERRAIN_NAMES } from "../labels.ts";
import { useGame } from "../store.ts";

/** Neutral minor defense factor by rating (lower factor = tougher defender). */
const MINOR_RATINGS: readonly { label: string; factor: number }[] = [
  { label: "A (elite)", factor: 2 },
  { label: "B", factor: 3 },
  { label: "C", factor: 4 },
  { label: "D (weak)", factor: 5 },
];

const TERRAINS: readonly { label: string; value: number }[] = TERRAIN_NAMES.map(
  (name, value) => ({ label: `${name} (${value})`, value }),
);

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function CombatInfo(): React.JSX.Element | null {
  const open = useGame((s) => s.infoOpen);
  const setInfoOpen = useGame((s) => s.setInfoOpen);
  const ruleSet = useGame((s) => s.ruleSet);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setInfoOpen]);

  const powers = ruleSet.powers;
  const c = ruleSet.combat;

  // --- Simulator state -------------------------------------------------------
  const [attacker, setAttacker] = useState<PowerId>(powers[0]!.id);
  const [defenderSel, setDefenderSel] = useState<string>(powers[powers.length - 1]!.id);
  const [minorFactor, setMinorFactor] = useState(3);
  const [attackerTroops, setAttackerTroops] = useState(30_000);
  const [defenderTroops, setDefenderTroops] = useState(20_000);
  const [terrain, setTerrain] = useState(0);
  const [fortified, setFortified] = useState(false);
  const [bySea, setBySea] = useState(false);
  const [attackerFleets, setAttackerFleets] = useState(0);
  const [defenderFleets, setDefenderFleets] = useState(0);

  const scenario: BattleScenario = useMemo(
    () => ({
      attacker,
      attackerTroops,
      attackerFleets,
      bySea,
      defender: defenderSel === "neutral" ? null : (defenderSel as PowerId),
      minorDefenseFactor: minorFactor,
      defenderTroops,
      defenderFleets,
      terrain,
      fortified,
    }),
    [attacker, attackerTroops, attackerFleets, bySea, defenderSel, minorFactor, defenderTroops, defenderFleets, terrain, fortified],
  );

  const odds = useMemo(() => estimateBattle(ruleSet, scenario), [ruleSet, scenario]);

  if (!open) return null;

  const eff = (factor: number): string => effectiveness(ruleSet, factor).toFixed(2);
  const factors = [1, 2, 3, 4, 5];

  return (
    <div className="modal-overlay" onClick={() => setInfoOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How Combat Works</h2>
          <button className="popup-x" aria-label="Close" onClick={() => setInfoOpen(false)}>
            {"\u00d7"}
          </button>
        </div>

        <div className="modal-body">
          <section>
            <h3>The formulas</h3>
            <ul className="info-list">
              <li>
                <strong>Unit effectiveness.</strong> Each unit's strength comes from its
                combat factor: <code>eff = {c.factorBase} + ({c.factorMaxForScale} − factor) × {c.factorPerPoint}</code>.
                {" "}Lower factors are better, so a factor-1 unit is much stronger than a factor-5 one.
              </li>
              <li>
                <strong>Effective force</strong> = <code>units × eff × luck</code>, where luck is a
                random {"\u00b1"}20% each round (<code>0.8–1.2</code>).
              </li>
              <li>
                <strong>Attrition.</strong> A battle runs up to <code>{c.rounds}</code> rounds. Each
                round both sides lose casualties proportional to the enemy's share of total effective
                force: <code>loss ≈ units × (enemyForce / totalForce) × 0.5</code>. The side still
                standing (or with the greater effective force after {c.rounds} rounds) wins.
              </li>
              <li>
                <strong>Terrain</strong> multiplies the defender's effectiveness by{" "}
                <code>1 + {c.terrainDefensePerPoint} × terrain</code> (up to ×{(1 + 4 * c.terrainDefensePerPoint).toFixed(1)} on the harshest ground).
              </li>
              <li>
                <strong>Fortification</strong> multiplies the defender's effectiveness by{" "}
                <code>×{c.fortificationDefenseMultiplier}</code>.
              </li>
              <li>
                <strong>Sea assaults</strong> first fight fleet-vs-fleet. If the attacker loses at
                sea, no troops land. Neutral coasts defend at sea with factor 5.
              </li>
            </ul>
          </section>

          <section>
            <h3>Does distance matter?</h3>
            <p className="muted">
              No — distance does not change the odds. It only affects <em>reach</em>: armies move to
              adjacent land, fleets to any port, and each is capped per turn ({ruleSet.limits.armyMoves} army /
              {" "}{ruleSet.limits.fleetMoves} fleet moves). One caveat: if a <em>sea</em> assault into another
              region is repelled, the landing troops are lost rather than returning home.
            </p>
          </section>

          <section>
            <h3>Effectiveness by factor</h3>
            <table className="info-table">
              <thead>
                <tr>
                  <th>Factor</th>
                  {factors.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Effectiveness</td>
                  {factors.map((f) => (
                    <td key={f}>{eff(f)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3>Power modifiers</h3>
            <table className="info-table">
              <thead>
                <tr>
                  <th>Power</th>
                  <th>Army Off</th>
                  <th>Army Def</th>
                  <th>Navy Off</th>
                  <th>Navy Def</th>
                  <th>Army $/10k</th>
                  <th>Navy $/5</th>
                </tr>
              </thead>
              <tbody>
                {powers.map((p) => (
                  <tr key={String(p.id)}>
                    <td>
                      <span className="dot" style={{ background: p.color }} /> {p.name}
                    </td>
                    <td>{p.armyOffense} <span className="muted">({eff(p.armyOffense)})</span></td>
                    <td>{p.armyDefense} <span className="muted">({eff(p.armyDefense)})</span></td>
                    <td>{p.navyOffense} <span className="muted">({eff(p.navyOffense)})</span></td>
                    <td>{p.navyDefense} <span className="muted">({eff(p.navyDefense)})</span></td>
                    <td>${(p.armyCostPer10k / 1000).toFixed(0)}k</td>
                    <td>${(p.navyCostPer5 / 1000).toFixed(0)}k</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Values are the raw factor with (effectiveness) in parentheses. E.g. England attacks with
              factor {powers.find((p) => p.name === "England")?.armyOffense}, Russia defends with factor{" "}
              {powers.find((p) => p.name === "Russia")?.armyDefense}.
            </p>
          </section>

          <section>
            <h3>Battle simulator</h3>
            <div className="sim-grid">
              <label>
                Attacker
                <select value={String(attacker)} onChange={(e) => setAttacker(e.target.value as PowerId)}>
                  {powers.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Defender
                <select value={defenderSel} onChange={(e) => setDefenderSel(e.target.value)}>
                  {powers.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>{p.name}</option>
                  ))}
                  <option value="neutral">Neutral minor</option>
                </select>
              </label>

              <label>
                Attacker troops: {attackerTroops.toLocaleString()}
                <input type="range" min={1000} max={200_000} step={1000} value={attackerTroops} onChange={(e) => setAttackerTroops(Number(e.target.value))} />
              </label>
              <label>
                Defender troops: {defenderTroops.toLocaleString()}
                <input type="range" min={0} max={200_000} step={1000} value={defenderTroops} onChange={(e) => setDefenderTroops(Number(e.target.value))} />
              </label>

              {defenderSel === "neutral" && (
                <label>
                  Minor defense rating
                  <select value={minorFactor} onChange={(e) => setMinorFactor(Number(e.target.value))}>
                    {MINOR_RATINGS.map((r) => (
                      <option key={r.factor} value={r.factor}>{r.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Terrain
                <select value={terrain} onChange={(e) => setTerrain(Number(e.target.value))}>
                  {TERRAINS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              <label className="check">
                <input type="checkbox" checked={fortified} onChange={(e) => setFortified(e.target.checked)} />
                Fortified defender (×{c.fortificationDefenseMultiplier})
              </label>
              <label className="check">
                <input type="checkbox" checked={bySea} onChange={(e) => setBySea(e.target.checked)} />
                Sea assault
              </label>

              {bySea && (
                <>
                  <label>
                    Attacker fleets: {attackerFleets}
                    <input type="range" min={0} max={100} step={1} value={attackerFleets} onChange={(e) => setAttackerFleets(Number(e.target.value))} />
                  </label>
                  <label>
                    Defender fleets: {defenderFleets}
                    <input type="range" min={0} max={100} step={1} value={defenderFleets} onChange={(e) => setDefenderFleets(Number(e.target.value))} />
                  </label>
                </>
              )}
            </div>

            <div className="sim-result">
              <div className="sim-stat big">
                <span className="sim-label">Attacker wins</span>
                <span className="sim-value">{pct(odds.winProb)}</span>
              </div>
              {odds.navalWinProb !== null && (
                <div className="sim-stat">
                  <span className="sim-label">Wins the sea</span>
                  <span className="sim-value">{pct(odds.navalWinProb)}</span>
                </div>
              )}
              <div className="sim-stat">
                <span className="sim-label">Avg survivors if won</span>
                <span className="sim-value">{Math.round(odds.avgAttackerSurvivors).toLocaleString()}</span>
              </div>
              <div className="sim-stat">
                <span className="sim-label">Avg defenders if held</span>
                <span className="sim-value">{Math.round(odds.avgDefenderSurvivors).toLocaleString()}</span>
              </div>
            </div>
            <p className="muted small">Estimated from {odds.trials.toLocaleString()} simulated battles.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
