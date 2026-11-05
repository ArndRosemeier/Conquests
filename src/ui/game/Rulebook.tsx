import { useMemo, useState } from "react";
import type React from "react";
import {
  BATTLE_LOSS_RATE,
  BATTLE_LUCK_MIN,
  BATTLE_LUCK_SPREAD,
  NEUTRAL_NAVY_FACTOR,
  effectiveness,
} from "../../engine/state/combat.ts";
import { estimateBattle } from "../../engine/state/combatSim.ts";
import {
  HIST_VP_BY_VALUE,
  INCOME_BY_VALUE,
  INCOME_MAX_STEPS,
  INCOME_MIN,
  INCOME_SKEW,
  INCOME_STEP,
  MINOR_DEFENSE_FACTOR_BY_RATING,
  MINOR_TROOP_MULT_BY_DEFENSE,
} from "../../engine/state/setup.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { PowerId } from "../../engine/types.ts";
import type { Rating } from "../../engine/world/types.ts";
import { money } from "../content/powers.ts";

/**
 * The rules reference shown in the "?" guide. Every number on these pages is
 * read from the ruleset and engine constants, so the help can never drift from
 * how the game actually plays.
 */

const RATINGS: readonly Rating[] = ["A", "B", "C", "D"];
const FACTORS = [1, 2, 3, 4, 5] as const;
const TERRAIN = [0, 1, 2, 3, 4] as const;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const num = (x: number): string => x.toLocaleString("en-US", { maximumFractionDigits: 3 });
const n0 = (x: number): string => Math.round(x).toLocaleString("en-US");

function Formula({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="formula">{children}</div>;
}

function PowersPage({ rs }: { rs: RuleSet }): React.JSX.Element {
  const eff = (f: number): string => num(effectiveness(rs, f));
  return (
    <>
      <p>
        Each power has its own fighting factors and build costs. Factors run from 1 (best) to 5 (worst);
        the number in brackets is the strength per unit that factor gives in battle.
      </p>
      <div className="ref-scroll">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Power</th>
              <th>Army attack</th>
              <th>Army defense</th>
              <th>10,000 troops</th>
              <th>Navy attack</th>
              <th>Navy defense</th>
              <th>5 fleets</th>
            </tr>
          </thead>
          <tbody>
            {rs.playOrder.map((id) => {
              const p = rs.powers.find((d) => d.id === id)!;
              return (
                <tr key={String(p.id)}>
                  <td><span className="swatch" style={{ background: p.color }} />{p.name}</td>
                  <td>{p.armyOffense} <span className="muted">({eff(p.armyOffense)})</span></td>
                  <td>{p.armyDefense} <span className="muted">({eff(p.armyDefense)})</span></td>
                  <td>{money(p.armyCostPer10k)}</td>
                  <td>{p.navyOffense} <span className="muted">({eff(p.navyOffense)})</span></td>
                  <td>{p.navyDefense} <span className="muted">({eff(p.navyDefense)})</span></td>
                  <td>{money(p.navyCostPer5)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Factor to strength</h3>
      <Formula>
        strength = {num(rs.combat.factorBase)} + ({rs.combat.factorMaxForScale} − factor) × {num(rs.combat.factorPerPoint)}
      </Formula>
      <div className="ref-scroll">
        <table className="ref-table compact">
          <thead><tr><th>Factor</th>{FACTORS.map((f) => <th key={f}>{f}</th>)}</tr></thead>
          <tbody><tr><td>Strength per unit</td>{FACTORS.map((f) => <td key={f}>{eff(f)}</td>)}</tr></tbody>
        </table>
      </div>
      <p className="muted">
        Powers act, and their battles resolve, in this order: {rs.playOrder.map((id) => rs.powers.find((d) => d.id === id)?.name).join(", ")}.
      </p>
    </>
  );
}

function BattlesPage({ rs }: { rs: RuleSet }): React.JSX.Element {
  const c = rs.combat;
  const luckHi = BATTLE_LUCK_MIN + BATTLE_LUCK_SPREAD;
  return (
    <>
      <h3>1. Strength of each side</h3>
      <Formula>attack per troop = strength(attacker's army attack factor)</Formula>
      <Formula>
        defense per troop = strength(defense factor) × (1 + terrain × {num(c.terrainDefensePerPoint)}) × ({num(c.fortificationDefenseMultiplier)} if fortified, else 1)
      </Formula>
      <p>
        A power defends with its army defense factor. An independent country uses the factor of its
        defensive rating (see Territories). Terrain runs from 0 to 4:
      </p>
      <div className="ref-scroll">
        <table className="ref-table compact">
          <thead><tr><th>Terrain</th>{TERRAIN.map((t) => <th key={t}>{t}</th>)}</tr></thead>
          <tbody><tr><td>Defense ×</td>{TERRAIN.map((t) => <td key={t}>{num(1 + t * c.terrainDefensePerPoint)}</td>)}</tr></tbody>
        </table>
      </div>

      <h3>2. Up to {c.rounds} rounds of attrition</h3>
      <p>Each round, both sides roll their strength for the round:</p>
      <Formula>A = attackers × attack per troop × luck,&nbsp;&nbsp; D = defenders × defense per troop × luck</Formula>
      <Formula>luck = random between {num(BATTLE_LUCK_MIN)} and {num(luckHi)}, rolled separately for each side</Formula>
      <Formula>attacker losses = round(attackers × D ÷ (A + D) × {num(BATTLE_LOSS_RATE)})</Formula>
      <Formula>defender losses = round(defenders × A ÷ (A + D) × {num(BATTLE_LOSS_RATE)})</Formula>
      <p>The battle stops early as soon as one side has no troops left.</p>

      <h3>3. Who wins</h3>
      <p>
        If only one side has troops left, it wins. If both still stand after {c.rounds} rounds, the attacker wins
        when <b>attackers left × attack per troop ≥ defenders left × defense per troop</b> (no luck in this check).
      </p>

      <h3>4. Landings by sea</h3>
      <p>
        A landing first fights a naval battle, fleets against the fleets in the harbour, with the same formula
        using navy factors. An independent harbour defends with factor {NEUTRAL_NAVY_FACTOR}. Each fleet carries
        {" "}{rs.limits.troopsPerFleet.toLocaleString("en-US")} troops.
      </p>
      <ul>
        <li>Lose at sea: surviving fleets sail home. Troops come home only if they sailed within the same region; a landing across regions drowns.</li>
        <li>Win at sea: the harbour's fleets are destroyed, then the troops fight the land battle above. Fleets with no troops just clear the harbour and sail home.</li>
      </ul>

      <h3>5. Order and outcome</h3>
      <ul>
        <li>All moves into places their owner already holds land first. Then assaults resolve in play order.</li>
        <li>All of one power's armies marching into the same place this season fight as one combined force. Each sea landing fights on its own.</li>
        <li>If the place already fell to the same power earlier in the resolution, later waves simply reinforce it.</li>
        <li>Attacking another power's territory declares war on it.</li>
        <li>
          Winner: takes the territory with its survivors (at least 1), any fortress is destroyed, the territory's
          victory points move from the old owner to the new one, and the winner gains {rs.victory.pointsPerBattleWon} battle point
          while a defending power loses {rs.victory.pointsPerBattleLost}.
        </li>
        <li>
          Repelled: the defender keeps its survivors (at least 1). The attacker's survivors go back to the places they
          came from, split in proportion to what each sent, but only if those places are still held. The attacker loses {rs.victory.pointsPerBattleLost} point
          and a defending power gains {rs.victory.pointsPerBattleWon}.
        </li>
      </ul>
      <OddsCalculator rs={rs} />
    </>
  );
}

function OddsCalculator({ rs }: { rs: RuleSet }): React.JSX.Element {
  const [attacker, setAttacker] = useState<string>(String(rs.playOrder[0]));
  const [defender, setDefender] = useState<string>("minor");
  const [minorRating, setMinorRating] = useState<Rating>("C");
  const [att, setAtt] = useState(50_000);
  const [def, setDef] = useState(30_000);
  const [terrain, setTerrain] = useState(1);
  const [fortified, setFortified] = useState(false);
  const [bySea, setBySea] = useState(false);
  const [attFleets, setAttFleets] = useState(50);
  const [defFleets, setDefFleets] = useState(0);

  const odds = useMemo(
    () =>
      estimateBattle(
        rs,
        {
          attacker: attacker as PowerId,
          attackerTroops: Math.max(0, att),
          attackerFleets: Math.max(0, attFleets),
          bySea,
          defender: defender === "minor" ? null : (defender as PowerId),
          minorDefenseFactor: MINOR_DEFENSE_FACTOR_BY_RATING[minorRating],
          defenderTroops: Math.max(0, def),
          defenderFleets: Math.max(0, defFleets),
          terrain,
          fortified,
        },
        1500,
      ),
    [rs, attacker, defender, minorRating, att, def, terrain, fortified, bySea, attFleets, defFleets],
  );

  const numInput = (value: number, set: (n: number) => void, step: number): React.JSX.Element => (
    <input type="number" min={0} step={step} value={value} onChange={(e) => set(Number(e.target.value) || 0)} />
  );

  return (
    <div className="odds-calc">
      <h3>Try it: battle odds</h3>
      <p className="muted">Runs the real battle code {odds.trials.toLocaleString("en-US")} times with these numbers.</p>
      <div className="odds-grid">
        <label>Attacker
          <select value={attacker} onChange={(e) => setAttacker(e.target.value)}>
            {rs.powers.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
          </select>
        </label>
        <label>Troops {numInput(att, setAtt, 1000)}</label>
        <label>Defender
          <select value={defender} onChange={(e) => setDefender(e.target.value)}>
            <option value="minor">Independent country</option>
            {rs.powers.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
          </select>
        </label>
        <label>Troops {numInput(def, setDef, 1000)}</label>
        {defender === "minor" && (
          <label>Defensive rating
            <select value={minorRating} onChange={(e) => setMinorRating(e.target.value as Rating)}>
              {RATINGS.map((r) => <option key={r} value={r}>{r} (factor {MINOR_DEFENSE_FACTOR_BY_RATING[r]})</option>)}
            </select>
          </label>
        )}
        <label>Terrain
          <select value={terrain} onChange={(e) => setTerrain(Number(e.target.value))}>
            {TERRAIN.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={fortified} onChange={(e) => setFortified(e.target.checked)} /> Fortified</label>
        <label className="check"><input type="checkbox" checked={bySea} onChange={(e) => setBySea(e.target.checked)} /> Landing by sea</label>
        {bySea && <label>Attacking fleets {numInput(attFleets, setAttFleets, 5)}</label>}
        {bySea && <label>Harbour fleets {numInput(defFleets, setDefFleets, 5)}</label>}
      </div>
      <div className="odds-result">
        <b>{pct(odds.winProb)}</b> chance to take it
        {odds.navalWinProb !== null && <> · {pct(odds.navalWinProb)} to win at sea</>}
        <span className="muted">
          {odds.winProb > 0 && <> · if won, about {n0(odds.avgAttackerSurvivors)} attackers left</>}
          {odds.winProb < 1 && <> · if lost, about {n0(odds.avgDefenderSurvivors)} defenders left</>}
        </span>
      </div>
    </div>
  );
}

function EconomyPage({ rs }: { rs: RuleSet }): React.JSX.Element {
  const s = rs.subversion;
  const e = rs.economy;
  const lim = rs.limits;
  const swingLo = 1 - s.bribeVariance;
  const swingHi = 1 + s.bribeVariance;
  return (
    <>
      <h3>Seasons</h3>
      <ul>
        <li>Four seasons a year. Marches and landings are allowed every season: {lim.armyMoves} army moves and {lim.fleetMoves} fleet moves per turn.</li>
        <li>Spring only: raise troops, build fleets, fortify, send loans and aid (not in the very first spring), spy and bribe (allowed in the first spring too).</li>
        <li>Every army move must leave at least {lim.minGarrison.toLocaleString("en-US")} troops behind.</li>
      </ul>

      <h3>Income</h3>
      <Formula>each spring: treasury += sum of the income of every territory you hold</Formula>

      <h3>Costs</h3>
      <ul>
        <li>Troops: bought in blocks of {rs.costs.troopBuildIncrement.toLocaleString("en-US")}, price per power (see Powers), only in your own supply centers.</li>
        <li>Fleets: bought in blocks of {rs.costs.fleetBuildIncrement}, only in supply centers that are ports.</li>
        <li>Fortress: {money(rs.costs.fortification)} per territory. Multiplies the defense of its troops by {num(rs.combat.fortificationDefenseMultiplier)} and is destroyed when the territory falls.</li>
        <li>Spy report: {money(rs.costs.spyMinor)}, or {money(rs.costs.spyFortified)} if the target is fortified or a power's supply center.</li>
      </ul>

      <h3>Loans to a power</h3>
      <p>The money always goes to the other power. If you are at war with it and send at least {money(e.minPeaceLoan)}:</p>
      <Formula>chance of peace = min(1, loan ÷ {money(e.guaranteedPeaceLoan)})</Formula>

      <h3>Aid to an independent country</h3>
      <Formula>extra troops = floor(aid × {num(e.minorTroopsPerDollar)}) &nbsp;(one soldier per ${num(1 / e.minorTroopsPerDollar)})</Formula>

      <h3>Bribes</h3>
      <p>Each bribe costs {money(s.bribeCost)} and the money is spent whether or not the country flips.</p>
      <Formula>
        troops removed = max(1, floor({money(s.bribeCost)} × {num(s.baseTroopsPerDollar)} ÷ (1 + income × {s.worthResistance.toExponential(0)}) × swing))
      </Formula>
      <Formula>swing = random between {num(swingLo)} and {num(swingHi)}</Formula>
      <p>
        When the garrison reaches zero the country joins you with {s.coupGarrison.toLocaleString("en-US")} troops.
        A coup gives no victory points. For example, a {money(1_000_000)} income country loses about
        {" "}{n0((s.bribeCost * s.baseTroopsPerDollar) / (1 + 1_000_000 * s.worthResistance))} troops per bribe on average.
      </p>
    </>
  );
}

function TerritoriesPage({ rs }: { rs: RuleSet }): React.JSX.Element {
  const v = rs.victory;
  return (
    <>
      <p>
        Every territory has a value rating and a defensive rating (A best, D worst), a terrain from 0 to 4, and
        is either a port or not. Ratings set its income, victory points and how independent countries defend.
      </p>
      <div className="ref-scroll">
        <table className="ref-table">
          <thead>
            <tr><th>Rating</th><th>Income</th><th>Victory points</th><th>Independent defense factor</th><th>Garrison size ×</th></tr>
          </thead>
          <tbody>
            {RATINGS.map((r) => (
              <tr key={r}>
                <td>{r}</td>
                <td>{money(INCOME_BY_VALUE[r])}</td>
                <td>{HIST_VP_BY_VALUE[r]}</td>
                <td>{MINOR_DEFENSE_FACTOR_BY_RATING[r]} <span className="muted">({num(effectiveness(rs, MINOR_DEFENSE_FACTOR_BY_RATING[r]))})</span></td>
                <td>{num(MINOR_TROOP_MULT_BY_DEFENSE[r])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Income and victory points use the value rating. They apply to the great powers' own lands in every scenario,
        and to every territory in the historical scenarios (1880 and 1914). Defense factor and garrison size use the defensive rating.
      </p>

      <h3>Independent countries in the Open World scenario</h3>
      <Formula>
        income = {money(INCOME_MIN)} + round({INCOME_MAX_STEPS} × r^{num(INCOME_SKEW)}) × {money(INCOME_STEP)}, r random 0..1
      </Formula>
      <p>So income runs from {money(INCOME_MIN)} to {money(INCOME_MIN + INCOME_MAX_STEPS * INCOME_STEP)}, with rich countries rare.</p>
      <Formula>victory points = random whole number from {v.standardAreaValueMin} to {v.standardAreaValueMax}</Formula>
      <p>
        Independent garrisons start between about 500 and 400,000 troops: most hold 12k to 100k, a few are almost
        empty and a few are fortress states. The size is multiplied by the garrison factor above and by the
        territory's size (0.6× for a small island up to 1.2× for a large country), then jittered by ±10%.
      </p>

      <h3>Victory</h3>
      <Formula>score = VP of territories you conquered − VP of territories conquered from you + battle points won − battle points lost</Formula>
      <p className="muted">Everyone starts at 0. Your starting lands and countries won by bribery score nothing, but if a rival conquers one of them you lose its VP.</p>
      <ul>
        <li>Win by reaching the chosen winning score ({v.options.filter((o) => o > 0).join(", ")}, or play without a limit). If several powers pass it at once, the highest score wins.</li>
        <li>A power that holds no territory is out. The last power standing also wins.</li>
      </ul>
    </>
  );
}

export const REFERENCE_PAGES: readonly { title: string; render: (rs: RuleSet) => React.JSX.Element }[] = [
  { title: "Powers", render: (rs) => <PowersPage rs={rs} /> },
  { title: "Battles", render: (rs) => <BattlesPage rs={rs} /> },
  { title: "Money & spies", render: (rs) => <EconomyPage rs={rs} /> },
  { title: "Territories", render: (rs) => <TerritoriesPage rs={rs} /> },
];
