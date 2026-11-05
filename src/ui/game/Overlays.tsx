import { useEffect, useState } from "react";
import type React from "react";
import { calendarYear } from "../../engine/state/gameState.ts";
import { getPowerState } from "../../engine/state/helpers.ts";
import { sound } from "../audio/sound.ts";
import type { AudioSettings } from "../audio/sound.ts";
import { ART } from "../content/herald.ts";
import { lookOf, money, powerName } from "../content/powers.ts";
import { useGame } from "../store.ts";
import type { AiSpeed } from "../store.ts";

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** The World Herald: a front page at the start of every year. */
export function Herald(): React.JSX.Element | null {
  const herald = useGame((s) => s.herald);
  const close = useGame((s) => s.closeHerald);
  useEscape(close);
  if (!herald) return null;
  return (
    <div className="overlay" onClick={close}>
      <article className="paper" onClick={(e) => e.stopPropagation()}>
        <header className="paper-mast">
          <div className="paper-meta">
            <span>Vol. {herald.year - 1879}</span>
            <span>Year in review · {herald.year}</span>
            <span>One penny</span>
          </div>
          <h1>The World Herald</h1>
          <div className="paper-rule" />
        </header>
        <div className="paper-lead">
          <img src={herald.lead.art} alt="" />
          <h2>{herald.lead.headline}</h2>
        </div>
        {herald.more.length > 0 && (
          <div className="paper-cols">
            {herald.more.map((s, i) => (
              <p key={i}>{s.headline}</p>
            ))}
          </div>
        )}
        <footer className="paper-foot">
          {herald.income > 0 && <span className="paper-income">Your treasury receives {money(herald.income)} in taxes and trade.</span>}
          <span className="paper-tip"><b>Advice to statesmen:</b> {herald.tip}</span>
          <button className="btn primary" onClick={close}>Continue</button>
        </footer>
      </article>
    </div>
  );
}

/** Victory, defeat, or watching on after being knocked out. */
export function EndScreen(): React.JSX.Element | null {
  const gs = useGame((s) => s.gameState);
  const me = useGame((s) => s.humanPower);
  const ruleSet = useGame((s) => s.ruleSet);
  const spectating = useGame((s) => s.spectating);
  const spectate = useGame((s) => s.spectate);
  const goTitle = useGame((s) => s.goTitle);
  const goNewGame = useGame((s) => s.goNewGame);
  if (gs === null || me === null) return null;
  const out = getPowerState(gs, me).eliminated;
  if (gs.winner === null && !out) return null;
  if (gs.winner === null && spectating) return null;
  const won = gs.winner === me;
  return (
    <div className="overlay end">
      <div className={`end-card ${won ? "won" : "lost"}`}>
        <img className="end-art" src={won ? ART.victory : ART.defeat} alt="" />
        <div className="end-body">
          <img className="end-crest" src={lookOf(String(gs.winner ?? me)).crest} alt="" />
          <h1>{won ? "Victory!" : gs.winner !== null ? `${powerName(ruleSet.powers, gs.winner)} wins` : "Your empire has fallen"}</h1>
          <p>
            {won
              ? `In ${calendarYear(gs)} the world bows to ${powerName(ruleSet.powers, me)}. Bands play, bankers smile, mapmakers reach for your colour.`
              : gs.winner !== null
                ? `${powerName(ruleSet.powers, gs.winner)} reached the goal first, in ${calendarYear(gs)}.`
                : "Your last territory is lost. History will be kind, perhaps."}
          </p>
          <div className="end-buttons">
            <button className="btn primary" onClick={() => goNewGame(me)}>Play again</button>
            {gs.winner === null && <button className="btn" onClick={spectate}>Watch the rest</button>}
            <button className="btn ghost" onClick={goTitle}>Title screen</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameMenu(): React.JSX.Element | null {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const goTitle = useGame((s) => s.goTitle);
  const mode = useGame((s) => s.mode);
  const close = (): void => setPanel("none");
  useEscape(close);
  if (panel !== "menu") return null;
  const leaveText = mode === "local" ? "Leave this game? It is autosaved every season." : "Leave this online game? The computer plays your nation until you return through the invite link.";
  return (
    <div className="overlay" onClick={close}>
      <div className="modal glass menu-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Paused</h2>
        <button className="btn primary wide" onClick={close}>Resume</button>
        <button className="btn wide" onClick={() => setPanel("saves")}>Save or load</button>
        <button className="btn wide" onClick={() => setPanel("guide")}>How to play</button>
        <button className="btn wide" onClick={() => setPanel("settings")}>Settings</button>
        <button className="btn ghost wide" onClick={() => { if (window.confirm(leaveText)) goTitle(); }}>Quit to title</button>
      </div>
    </div>
  );
}

export function Settings(): React.JSX.Element | null {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const aiSpeed = useGame((s) => s.aiSpeed);
  const setAiSpeed = useGame((s) => s.setAiSpeed);
  const [a, setA] = useState<AudioSettings>(sound.settings);
  useEffect(() => sound.subscribe(() => setA({ ...sound.settings })), []);
  const close = (): void => setPanel("none");
  useEscape(close);
  if (panel !== "settings") return null;
  const slider = (key: "music" | "sfx" | "voice", label: string): React.JSX.Element => (
    <label className="slider">
      <span>{label} <b>{Math.round(a[key] * 100)}%</b></span>
      <input type="range" min={0} max={1} step={0.05} value={a[key]} onChange={(e) => {
        sound.update({ [key]: Number(e.target.value) });
        if (key === "sfx") sound.play("click");
      }} />
    </label>
  );
  return (
    <div className="overlay" onClick={close}>
      <div className="modal glass settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" aria-label="Close" onClick={close}>×</button>
        <h2>Settings</h2>
        {slider("music", "Music")}
        {slider("sfx", "Sound effects")}
        {slider("voice", "Herald's voice")}
        <label className="check">
          <input type="checkbox" checked={a.muted} onChange={(e) => sound.update({ muted: e.target.checked })} /> Mute everything
        </label>
        <div className="field">
          <span>Pace of rival turns</span>
          <div className="segmented">
            {(["relaxed", "normal", "fast"] as AiSpeed[]).map((s) => (
              <button key={s} className={s === aiSpeed ? "on" : ""} onClick={() => setAiSpeed(s)}>{s}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const GUIDE: readonly { title: string; art: string; body: readonly string[] }[] = [
  {
    title: "The goal",
    art: ART.victory,
    body: [
      "Six great powers race for the world. Taking a territory earns its victory points; the first power to the winning score wins. A power that loses every territory is out.",
      "Hover any territory to see what it is worth. Your score and the race are on screen at all times.",
    ],
  },
  {
    title: "Seasons and turns",
    art: ART.newyear,
    body: [
      "A year has four seasons. Each season every power gives its orders in turn, then all marches and landings resolve at once.",
      "Spring is special: income arrives, and only in spring can you raise troops, build fleets, fortify, spy, bribe and send loans. In your very first spring you can already march, spy and bribe.",
    ],
  },
  {
    title: "Armies",
    art: ART.land,
    body: [
      "Click one of your territories, then March, then a glowing neighbour. Choose how many troops go; 1,000 must stay behind.",
      "Every army you send into the same place this season fights as one force. Defenders get help from terrain and fortresses. Each lost battle costs a victory point.",
    ],
  },
  {
    title: "Fleets",
    art: ART.naval,
    body: [
      "Fleets sail from any port to any port in one season, each one carrying 1,000 troops. A landing first has to beat the fleets defending the harbour.",
      "If a landing far from home is beaten back at sea, the troops are lost. Close to home they make it back.",
    ],
  },
  {
    title: "Spies, bribes and money",
    art: ART.spy,
    body: [
      "You only see foreign garrisons after spying, and the report ages. Spy before you attack.",
      "Bribes chip away at an independent country's garrison until it changes sides. It costs no blood but gives no victory points.",
      "A loan to a power you are at war with may buy peace: the bigger the sum, the better the odds.",
    ],
  },
];

export function Guide(): React.JSX.Element | null {
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const [page, setPage] = useState(0);
  const close = (): void => setPanel("none");
  useEscape(close);
  if (panel !== "guide") return null;
  const p = GUIDE[page]!;
  return (
    <div className="overlay" onClick={close}>
      <div className="modal glass guide-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" aria-label="Close" onClick={close}>×</button>
        <img src={p.art} alt="" className="guide-art" key={p.art} />
        <div className="guide-body">
          <nav className="guide-tabs">
            {GUIDE.map((g, i) => (
              <button key={g.title} className={i === page ? "on" : ""} onClick={() => setPage(i)}>{g.title}</button>
            ))}
          </nav>
          <h2>{p.title}</h2>
          {p.body.map((b, i) => <p key={i}>{b}</p>)}
          <div className="guide-nav">
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Back</button>
            {page < GUIDE.length - 1 ? (
              <button className="btn primary" onClick={() => setPage(page + 1)}>Next</button>
            ) : (
              <button className="btn primary" onClick={close}>Got it</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
