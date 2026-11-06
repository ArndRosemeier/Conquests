import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { calendarYear } from "../../engine/state/gameState.ts";
import { reputationOf, truceUntil } from "../../engine/state/diplomacy.ts";
import { allAreas, getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { canBuild } from "../../engine/state/legalActions.ts";
import { isFoundingTurn } from "../../engine/state/phases.ts";
import { annualIncomeFor } from "../../engine/state/scoring.ts";
import type { Season } from "../../engine/types.ts";
import { lookOf, money, powerName } from "../content/powers.ts";
import { getNet, netSnapshot, subscribeNet, useGame } from "../store.ts";
import { WhatsNewButton } from "./Overlays.tsx";

/** Online: who plays which nation (empty offline). */
function useSeatNames(): ReadonlyMap<string, { name: string; online: boolean }> {
  useSyncExternalStore(subscribeNet, netSnapshot);
  const net = getNet();
  const out = new Map<string, { name: string; online: boolean }>();
  for (const [power, seat] of Object.entries(net?.room?.seats ?? {})) out.set(power, { name: seat.name, online: net!.seatOnline(power) });
  return out;
}

const SEASON_ICON: Record<Season, string> = { SPRING: "❀", SUMMER: "☀", FALL: "❦", WINTER: "❄" };
const SEASON_NAME: Record<Season, string> = { SPRING: "Spring", SUMMER: "Summer", FALL: "Autumn", WINTER: "Winter" };

/** A number that rolls to its new value instead of jumping. */
function useRolling(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / 700);
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3));
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return shown;
}

/** One click between the flat map and the globe. */
function ViewToggle(): React.JSX.Element {
  const view = useGame((s) => s.mapView);
  const setMapView = useGame((s) => s.setMapView);
  const globe = view === "globe";
  return (
    <button
      className={`view-toggle${globe ? " is-globe" : ""}`}
      title={globe ? "Unwrap to the flat map (G)" : "Wrap onto the globe (G)"}
      aria-label={globe ? "Show the flat map" : "Show the globe"}
      aria-pressed={globe}
      onClick={() => setMapView(globe ? "flat" : "globe")}
    >
      <span className={globe ? "" : "on"}>🗺<i>Map</i></span>
      <span className={globe ? "on" : ""}>🌐<i>Globe</i></span>
    </button>
  );
}

export function TopBar(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const world = useGame((s) => s.world);
  const setPanel = useGame((s) => s.setPanel);
  const treasury = useRolling(gs !== null && me !== null ? getPowerState(gs, me).treasury : 0);
  const score = useRolling(gs !== null && me !== null ? getPowerState(gs, me).score : 0);
  if (gs === null) return null;
  const def = me === null ? null : ruleSet.powers.find((p) => p.id === me) ?? null;
  const income = me === null ? 0 : annualIncomeFor(gs, ruleSet, world, me);
  return (
    <header className="topbar">
      <div className="plate date-plate" title="Each year has four seasons. Building and diplomacy happen in spring.">
        <span className={`season-icon s-${gs.season.toLowerCase()}`}>{SEASON_ICON[gs.season]}</span>
        <span className="date-text">
          <b>{SEASON_NAME[gs.season]}</b>
          <span>{calendarYear(gs)}</span>
        </span>
      </div>
      {def && (
        <div className="plate you-plate" style={{ ["--c" as string]: def.color }}>
          <img src={lookOf(String(def.id)).crest} alt="" />
          <div className="you-stats">
            <span className="you-name">{def.name}</span>
            <span className="stat" title="Treasury: what you can spend now">
              <i>Treasury</i> <b>{money(treasury)}</b>
            </span>
            <span className="stat" title="Paid out every spring by the territories you hold">
              <i>Income</i> <b>{money(income)}/yr</b>
            </span>
            <span className="stat" title={gs.winningScore > 0 ? `First to ${gs.winningScore} wins` : "No score limit"}>
              <i>Score</i> <b>{Math.round(score)}{gs.winningScore > 0 ? <small> / {gs.winningScore}</small> : null}</b>
            </span>
          </div>
        </div>
      )}
      <RoomChip />
      <div className="topbar-right">
        <ViewToggle />
        <WhatsNewButton />
        <button className="icon-btn" title="Diplomacy (D)" onClick={() => setPanel("diplomacy")}>🕊</button>
        <button className="icon-btn" title="How to play" onClick={() => setPanel("guide")}>?</button>
        <button className="icon-btn" title="Menu" onClick={() => setPanel("menu")}>☰</button>
      </div>
    </header>
  );
}

export function Standings(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const [open, setOpen] = useState(true);
  const names = useSeatNames();
  if (gs === null) return null;
  const counts = new Map<string, number>();
  for (const a of allAreas(gs)) if (a.owner !== null) counts.set(String(a.owner), (counts.get(String(a.owner)) ?? 0) + 1);
  const rows = ruleSet.playOrder
    .map((id) => ({ id, def: ruleSet.powers.find((p) => p.id === id)!, st: getPowerState(gs, id) }))
    .sort((a, b) => b.st.score - a.st.score);
  const goal = gs.winningScore > 0 ? gs.winningScore : Math.max(100, ...rows.map((r) => r.st.score));
  return (
    <section className={`standings glass${open ? "" : " closed"}`}>
      <button className="standings-head" onClick={() => setOpen(!open)}>
        <span>The Race</span>
        <small>{gs.winningScore > 0 ? `first to ${gs.winningScore}` : "no limit"}</small>
        <i>{open ? "▾" : "▸"}</i>
      </button>
      {open && (
        <ol>
          {rows.map(({ id, def, st }) => {
            const active = gs.activePower === id && gs.stage === "PLAYER";
            const war = me !== null && id !== me && isAtWar(gs, me, id);
            const truce = me !== null && id !== me && truceUntil(gs, me, id) !== null;
            return (
              <li key={String(id)} className={`${id === me ? "you" : ""}${st.eliminated ? " out" : ""}${active ? " active" : ""}`} style={{ ["--c" as string]: def.color }}>
                <img src={lookOf(String(id)).crest} alt="" />
                <div className="race-body">
                  <div className="race-line">
                    <span className="race-name">
                      {def.name}{id === me ? " (you)" : ""}
                      {names.has(String(id)) && id !== me && <span className="player-name"> · {names.get(String(id))!.name}{names.get(String(id))!.online ? "" : " (away)"}</span>}
                    </span>
                    {war && <span className="war-tag" title="At war with you">⚔</span>}
                    {truce && <span className="war-tag" title="Truce with you">🕊</span>}
                    {active && <span className="thinking">{id === me ? "your turn" : "thinking…"}</span>}
                    <b>{st.eliminated ? "out" : st.score}</b>
                  </div>
                  <div className="race-bar">
                    <div style={{ width: `${Math.max(0, Math.min(100, (st.score / goal) * 100))}%` }} />
                  </div>
                  <small>{counts.get(String(id)) ?? 0} territories · reputation {reputationOf(gs, ruleSet, id)}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const SEASON_HINT: Record<Season, string> = {
  SPRING: "Spring: raise troops and fleets, fortify, spy, bribe and send loans. Then march.",
  SUMMER: "Summer: armies march and fleets sail. Building waits for spring.",
  FALL: "Autumn: armies march and fleets sail. Building waits for spring.",
  WINTER: "Winter: last moves of the year. Income arrives in spring.",
};

export function TurnDock(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const endTurn = useGame((s) => s.endTurn);
  const undo = useGame((s) => s.undo);
  const canUndo = useGame((s) => s.canUndo);
  const move = useGame((s) => s.move);
  const names = useSeatNames();
  if (gs === null) return null;
  const yours = me !== null && gs.stage === "PLAYER" && gs.activePower === me && gs.winner === null;
  const who = gs.activePower === null ? undefined : names.get(String(gs.activePower));
  const myOrders = gs.pending.filter((m) => m.power === me).length;
  let hint = SEASON_HINT[gs.season];
  if (isFoundingTurn(gs)) hint = "Your first season: march, spy and bribe now. Building starts next spring.";
  if (yours && canBuild(gs) && myOrders === 0) hint = "Spring! Click one of your territories with a ★ to raise troops.";
  return (
    <div className={`dock glass${yours ? " yours" : ""}`}>
      {yours ? (
        <>
          <div className="dock-hint">{move ? (move.to === null ? "Pick a destination on the map" : "Choose how many to send") : hint}</div>
          <div className="dock-moves" title="Moves left this turn">
            <span>⚔ {gs.armyMovesRemaining}</span>
            <span>⚓ {gs.fleetMovesRemaining}</span>
          </div>
          <button className="btn ghost" disabled={!canUndo} onClick={undo} title="Take back your last order">↶ Undo</button>
          <button className="btn primary end-turn" onClick={endTurn}>
            End turn{myOrders > 0 ? ` · ${myOrders} order${myOrders > 1 ? "s" : ""}` : ""}
          </button>
        </>
      ) : (
        <div className="dock-wait">
          {gs.winner !== null ? (
            "The game is over."
          ) : gs.stage === "COMBAT" ? (
            <><span className="spinner" /> Armies clash across the world…</>
          ) : (
            <><span className="spinner" /> {who ? `${who.name} (${powerName(ruleSet.powers, gs.activePower)})` : powerName(ruleSet.powers, gs.activePower)} is making plans…</>
          )}
        </div>
      )}
    </div>
  );
}

export function Toasts(): React.JSX.Element {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  const focusArea = useGame((s) => s.focusArea);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast ${t.tone}`}
          onClick={() => {
            if (t.area !== undefined) focusArea(t.area);
            dismiss(t.id);
          }}
        >
          <b>{t.title}</b>
          {t.body && <span>{t.body}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chronicle(): React.JSX.Element {
  const log = useGame((s) => s.log);
  const focusArea = useGame((s) => s.focusArea);
  const [open, setOpen] = useState(false);
  return (
    <section className={`chronicle glass${open ? " open" : ""}`}>
      <button className="chronicle-head" onClick={() => setOpen(!open)}>
        <span>Chronicle</span>
        <small>{log.length > 0 ? log[0]!.text : "Nothing yet"}</small>
        <i>{open ? "▾" : "▴"}</i>
      </button>
      {open && (
        <ul>
          {log.map((l) => (
            <li key={l.id} className={l.tone} onClick={() => l.area !== undefined && focusArea(l.area)}>
              <time>{l.when}</time> {l.text}
            </li>
          ))}
          {log.length === 0 && <li className="muted">The world awaits.</li>}
        </ul>
      )}
    </section>
  );
}

export function SeasonBanner(): React.JSX.Element | null {
  const banner = useGame((s) => s.banner);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!banner) return;
    setShown(banner.id);
    const t = window.setTimeout(() => setShown(null), 2300);
    return () => window.clearTimeout(t);
  }, [banner]);
  if (!banner || shown !== banner.id) return null;
  return (
    <div className="season-banner" key={banner.id}>
      <span className={`season-icon s-${banner.season.toLowerCase()}`}>{SEASON_ICON[banner.season]}</span>
      <h2>{SEASON_NAME[banner.season]} {banner.year}</h2>
    </div>
  );
}

function RoomChip(): React.JSX.Element | null {
  useSyncExternalStore(subscribeNet, netSnapshot);
  const code = getNet()?.code;
  if (!code) return null;
  return (
    <div className="plate" title="Online room code. Friends can watch with it.">
      <span className="room-chip">{code}</span>
    </div>
  );
}
