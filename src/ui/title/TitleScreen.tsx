import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { CLASSIC_RULESET } from "../../engine/ruleset/classic.ts";
import { calendarYear } from "../../engine/state/gameState.ts";
import type { GameState } from "../../engine/state/gameState.ts";
import { CLASSIC_WORLD } from "../../engine/world/classic.ts";
import { sound } from "../audio/sound.ts";
import { BASE, storyFor, TICKER } from "../content/herald.ts";
import { lookOf } from "../content/powers.ts";
import { listAutosaves, loadAutosave } from "../persistence.ts";
import { useGame } from "../store.ts";
import { AttractGame } from "./attract.ts";
import { Globe } from "./globe.ts";

const PAINTINGS = ["title-maproom", "title-fleet", "title-expedition"].map((n) => `${BASE}art/${n}.webp`);
const TITLE = "CONQUESTS";
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** Slow pan-and-zoom crossfade through the three title paintings. */
function Paintings(): React.JSX.Element {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((v) => (v + 1) % PAINTINGS.length), 11000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="title-bg" aria-hidden>
      {PAINTINGS.map((src, n) => (
        <img key={src} src={src} alt="" className={`kb kb-${n}${n === i ? " on" : ""}`} />
      ))}
      <div className="title-shade" />
    </div>
  );
}

function Logo({ onTap }: { onTap: () => void }): React.JSX.Element {
  return (
    <h1 className="logo" onClick={onTap} aria-label="Conquests">
      {TITLE.split("").map((ch, i) => (
        <span key={i} style={{ animationDelay: `${0.25 + i * 0.07}s` }}>{ch}</span>
      ))}
      <i className="logo-glint" aria-hidden />
    </h1>
  );
}

/** The globe, driven by a live all-AI game. Returns fresh headlines through `onNews`. */
function LiveGlobe({ onNews, whirl }: { onNews: (h: string) => void; whirl: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<Globe | null>(null);
  const colors = useMemo(() => new Map(CLASSIC_RULESET.powers.map((p) => [String(p.id), p.color])), []);
  const newsRef = useRef(onNews);
  newsRef.current = onNews;

  useEffect(() => {
    const canvas = ref.current!;
    let globe: Globe;
    try {
      globe = new Globe(canvas, CLASSIC_WORLD);
    } catch {
      return; // No WebGL: the paintings alone carry the title.
    }
    globeRef.current = globe;
    const ro = new ResizeObserver(() => {
      const b = canvas.getBoundingClientRect();
      globe.resize(b.width, b.height);
    });
    ro.observe(canvas);
    const game = new AttractGame();
    globe.paint(game.state.areas, colors);
    let alive = true;
    let n = 0;
    const tick = async (): Promise<void> => {
      if (!alive) return;
      const before = game.state;
      const events = await game.step();
      if (!alive) return;
      let changed = before.areas !== game.state.areas;
      for (const e of events) {
        if (e.type === "BATTLE") {
          const color = colors.get(String(e.attacker)) ?? "#fff";
          for (const f of e.from) globe.attack(f, e.area, color);
          if (e.from.length === 0) globe.attack(e.area, e.area, color);
          changed = true;
        }
        const story = storyFor(e, CLASSIC_RULESET, CLASSIC_WORLD, `${game.state.year}-${n++}`, null);
        if (story && story.weight >= 25) newsRef.current(story.headline);
      }
      if (changed) {
        // Let the arcs land before the map changes colour.
        window.setTimeout(() => alive && globe.paint(game.state.areas, colors), 1100);
      }
      window.setTimeout(() => void tick(), game.state.stage === "COMBAT" ? 500 : 900);
    };
    const start = window.setTimeout(() => void tick(), 1500);
    return () => {
      alive = false;
      window.clearTimeout(start);
      ro.disconnect();
      globe.destroy();
      globeRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    if (whirl > 0) globeRef.current?.whirl();
  }, [whirl]);

  return (
    <canvas
      ref={ref}
      className="globe"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); globeRef.current?.pointerDown(e.clientX, e.clientY); }}
      onPointerMove={(e) => globeRef.current?.pointerMove(e.clientX, e.clientY)}
      onPointerUp={() => globeRef.current?.pointerUp()}
      onPointerCancel={() => globeRef.current?.pointerUp()}
    />
  );
}

function Ticker({ live }: { live: readonly string[] }): React.JSX.Element {
  const liveRef = useRef(live);
  liveRef.current = live;
  const pick = (): string[] => [...liveRef.current.slice(-5), ...[...TICKER].sort(() => Math.random() - 0.5).slice(0, 10)];
  // Refresh the headlines only between laps, so the strip never jumps.
  const [items, setItems] = useState<string[]>(pick);
  return (
    <div className="ticker" aria-label="World Herald headlines">
      <span className="ticker-badge">World Herald</span>
      <div className="ticker-track">
        <div className="ticker-run" style={{ animationDuration: `${items.join("").length * 0.11}s` }} onAnimationIteration={() => setItems(pick())}>
          {items.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TitleScreen(): React.JSX.Element {
  const goNewGame = useGame((s) => s.goNewGame);
  const loadGame = useGame((s) => s.loadGame);
  const setPanel = useGame((s) => s.setPanel);
  const goOnline = useGame((s) => s.goOnline);
  const [latest, setLatest] = useState<GameState | null>(null);
  const [news, setNews] = useState<string[]>([]);
  const [whirl, setWhirl] = useState(0);
  const [taps, setTaps] = useState(0);
  const [muted, setMuted] = useState(sound.settings.muted);

  useEffect(() => {
    sound.setMood("title");
    void (async () => {
      try {
        const saves = await listAutosaves();
        const first = saves[0];
        if (first !== undefined) setLatest(await loadAutosave(Number(first.key)));
      } catch {
        // No saves yet, or storage is blocked.
      }
    })();
  }, []);

  useEffect(() => sound.subscribe(() => setMuted(sound.settings.muted)), []);

  // Easter egg: the Konami code sends the globe spinning with a fanfare.
  useEffect(() => {
    let pos = 0;
    const onKey = (e: KeyboardEvent): void => {
      pos = e.key === KONAMI[pos] ? pos + 1 : e.key === KONAMI[0] ? 1 : 0;
      if (pos === KONAMI.length) {
        pos = 0;
        setWhirl((w) => w + 1);
        sound.play("fanfare");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tapLogo = (): void => {
    sound.play("stamp", 0.6);
    const n = taps + 1;
    setTaps(n);
    if (n % 5 === 0) {
      setWhirl((w) => w + 1);
      sound.play("cannon");
    }
  };

  const latestLabel = latest
    ? `${latest.season.charAt(0)}${latest.season.slice(1).toLowerCase()} ${calendarYear(latest)} as ${CLASSIC_RULESET.powers.find((p) => latest.powers[String(p.id)]?.control === "human")?.name ?? "your nation"}`
    : null;

  return (
    <div className="title">
      <Paintings />
      <LiveGlobe onNews={(h) => setNews((n) => [...n.slice(-12), h])} whirl={whirl} />
      <button className="icon-btn title-sound" title={muted ? "Sound on" : "Sound off"} onClick={() => sound.update({ muted: !muted })}>
        {muted ? "🔇" : "🔊"}
      </button>

      <main className="title-main">
        <div className="title-kicker">Six great powers · one world · 1880</div>
        <Logo onTap={tapLogo} />
        <p className="title-sub">Raise armies, launch fleets, bribe, spy and lend your way to a world empire before your rivals do.</p>
        <nav className="title-menu">
          <button className="btn primary big" onClick={() => goNewGame(null)}>
            New campaign
          </button>
          {latest && (
            <button className="btn big" onClick={() => loadGame(latest)}>
              Continue <small>{latestLabel}</small>
            </button>
          )}
          <div className="title-row">
            <button className="btn" onClick={goOnline}>Play online</button>
            <button className="btn" onClick={() => setPanel("saves")}>Load game</button>
            <button className="btn" onClick={() => setPanel("guide")}>How to play</button>
            <button className="btn" onClick={() => setPanel("settings")}>Settings</button>
          </div>
        </nav>
      </main>

      <section className="title-crests" aria-label="Choose a nation">
        <h3>Choose your nation</h3>
        <div className="crest-row">
          {CLASSIC_RULESET.powers.map((p, i) => (
            <button
              key={String(p.id)}
              className="crest"
              style={{ ["--c" as string]: p.color, animationDelay: `${1.2 + i * 0.08}s` }}
              onClick={() => goNewGame(p.id)}
              onMouseEnter={() => sound.play("click", 0.4)}
            >
              <img src={lookOf(String(p.id)).crest} alt="" />
              <span>{p.name}</span>
              <small>{lookOf(String(p.id)).difficulty}</small>
            </button>
          ))}
        </div>
      </section>

      <Ticker live={news} />
    </div>
  );
}
