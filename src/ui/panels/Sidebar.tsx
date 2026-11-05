import type React from "react";
import type { GameEvent } from "../../engine/state/events.ts";
import { allAreas } from "../../engine/state/helpers.ts";
import { getArea } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import { useGame } from "../store.ts";

function describe(e: GameEvent, ruleSet: RuleSet, world: WorldDefinition): string {
  const pn = (id: string | null): string =>
    id === null ? "Neutral" : (ruleSet.powers.find((p) => p.id === id)?.name ?? id);
  const an = (id: Parameters<typeof getArea>[1]): string => getArea(world, id).name;
  switch (e.type) {
    case "BATTLE":
      return `${pn(e.attacker)} ${e.attackerWon ? "captured" : "failed at"} ${an(e.area)} (def. ${pn(e.defender)})`;
    case "CONTROL_CHANGE":
      return `${an(e.area)}: ${pn(e.from)} -> ${pn(e.to)}`;
    case "SUBVERSION":
      return `${pn(e.by)} ${e.coup ? "couped" : "bribed"} ${an(e.area)}`;
    case "SPY_RESULT":
      return `${pn(e.by)} spied ${an(e.area)}`;
    case "WAR_DECLARED":
      return `${pn(e.by)} attacks ${pn(e.against)}: war!`;
    case "WAR_ENDED":
      return `${pn(e.by)} makes peace with ${pn(e.against)}`;
    case "PEACE_LOAN_FAILED":
      return `${pn(e.by)}'s peace offer to ${pn(e.target)} was rejected`;
    case "POWER_ELIMINATED":
      return `${pn(e.power)} has been eliminated`;
    case "INCOME":
      return `${pn(e.power)} collects $${(e.amount / 1_000_000).toFixed(1)}M`;
    case "GAME_WON":
      return `${pn(e.power)} wins the game`;
    default:
      return "";
  }
}

export function Sidebar(): React.JSX.Element | null {
  const gameState = useGame((s) => s.gameState);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const humanPower = useGame((s) => s.humanPower);
  const log = useGame((s) => s.log);

  if (gameState === null) return null;

  const counts = new Map<string, number>();
  for (const a of allAreas(gameState)) {
    if (a.owner !== null) counts.set(String(a.owner), (counts.get(String(a.owner)) ?? 0) + 1);
  }
  const wars = humanPower !== null ? gameState.war[String(humanPower)] ?? [] : [];

  return (
    <aside className="sidebar">
      <section>
        <h3>Standings</h3>
        <table className="scores">
          <tbody>
            {ruleSet.playOrder.map((id) => {
              const p = gameState.powers[String(id)];
              if (p === undefined) return null;
              const def = ruleSet.powers.find((x) => x.id === id)!;
              return (
                <tr key={String(id)} className={id === humanPower ? "you" : ""}>
                  <td>
                    <span className="dot" style={{ background: def.color }} /> {def.name}
                  </td>
                  <td className="num">{p.score}</td>
                  <td className="num muted">{counts.get(String(id)) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="legend muted">score / areas</div>
      </section>

      <section>
        <h3>Your Wars</h3>
        {wars.length === 0 ? (
          <p className="muted">At peace.</p>
        ) : (
          <p>{wars.map((w) => ruleSet.powers.find((p) => p.id === w)?.name).join(", ")}</p>
        )}
      </section>

      <section className="log-section">
        <h3>Chronicle</h3>
        <ul className="log">
          {log.map((e, i) => (
            <li key={i}>{describe(e, ruleSet, world)}</li>
          ))}
          {log.length === 0 && <li className="muted">The world awaits.</li>}
        </ul>
      </section>
    </aside>
  );
}
