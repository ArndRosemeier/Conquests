import { useEffect, useState, useSyncExternalStore } from "react";
import type React from "react";
import { CLASSIC_RULESET } from "../../engine/ruleset/classic.ts";
import type { PowerId } from "../../engine/types.ts";
import { SCENARIOS } from "../../engine/world/scenarios.ts";
import { GAMEHUB, onlineAvailable } from "../../net/config.ts";
import type { RoomSummary } from "../../net/gamehub.ts";
import { rememberName, savedName } from "../../net/online.ts";
import type { RoomMeta } from "../../net/protocol.ts";
import { sound } from "../audio/sound.ts";
import { BASE } from "../content/herald.ts";
import { lookOf } from "../content/powers.ts";
import { getNet, netSnapshot, subscribeNet, useGame } from "../store.ts";

const GOALS = [
  { value: 500, label: "Quick" },
  { value: 1000, label: "Standard" },
  { value: 1500, label: "Epic" },
];

/** The ?room=CODE in the address, if someone followed an invite link. */
export function inviteCode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("room");
  } catch {
    return null;
  }
}

function inviteLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  url.hash = "";
  return url.toString();
}

/** Open rooms of this game, polled from the server while the entry screen is shown. */
function useOpenRooms(): RoomSummary[] {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => {
    if (!onlineAvailable()) return;
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const r = await fetch(`${GAMEHUB.url}/v1/apps/${GAMEHUB.app}/rooms`, { headers: { "x-app-key": GAMEHUB.appKey } });
        if (r.ok && alive) setRooms(((await r.json()) as { rooms: RoomSummary[] }).rooms);
      } catch {
        /* offline: no list */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return rooms;
}

function Entry(): React.JSX.Element {
  const hostOnline = useGame((s) => s.hostOnline);
  const joinOnline = useGame((s) => s.joinOnline);
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(inviteCode() ?? "");
  const [power, setPower] = useState<PowerId>(CLASSIC_RULESET.playOrder[0]!);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [goal, setGoal] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rooms = useOpenRooms();

  const run = async (job: () => Promise<void>): Promise<void> => {
    if (!name.trim()) {
      setError("Tell the others your name first.");
      return;
    }
    rememberName(name.trim());
    setBusy(true);
    setError(null);
    try {
      await job();
      sound.play("horn", 0.6);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^gamehub: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Followed an invite link and we know the name: join straight away.
  useEffect(() => {
    const invited = inviteCode();
    if (invited && savedName()) void run(() => joinOnline(savedName(), invited));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const host = (): Promise<void> => run(() => hostOnline(name.trim(), { scenarioId, winningScore: goal, seed: Math.floor(Math.random() * 1_000_000) }, power));
  const join = (c: string): Promise<void> => run(() => joinOnline(name.trim(), c));

  return (
    <div className="online-grid">
      <section className="glass online-card">
        <h2>Your name</h2>
        <input className="name-input" value={name} maxLength={24} placeholder="e.g. Admiral Arnd" onChange={(e) => setName(e.target.value)} />
        {error && <p className="danger">{error}</p>}
        <h2>Join a world</h2>
        <div className="join-row">
          <input value={code} maxLength={6} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && void join(code)} />
          <button className="btn primary" disabled={busy || code.length < 4} onClick={() => void join(code)}>Join</button>
        </div>
        <h3>Open worlds</h3>
        {rooms.length === 0 ? (
          <p className="muted small">No open worlds right now. Host one and invite your friends.</p>
        ) : (
          <ul className="room-list">
            {rooms.map((r) => {
              const meta = r.meta as RoomMeta | null;
              return (
                <li key={r.id}>
                  <div>
                    <b>{r.name}</b>
                    <span className="muted small">
                      {r.players} in the room · {SCENARIOS.find((s) => s.id === meta?.scenario)?.name ?? "Open World"}
                    </span>
                  </div>
                  <button className="btn small" disabled={busy} onClick={() => void join(r.id)}>Join</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="glass online-card">
        <h2>Host a world</h2>
        <p className="muted small">You pick the rules and a nation. Friends take the others; the computer plays the rest.</p>
        <div className="mini-nations">
          {CLASSIC_RULESET.powers.map((p) => (
            <button key={String(p.id)} className={`mini-nation${p.id === power ? " on" : ""}`} style={{ ["--c" as string]: p.color }} onClick={() => setPower(p.id)} title={p.name}>
              <img src={lookOf(String(p.id)).crest} alt="" />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>World</span>
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Length</span>
          <div className="segmented">
            {GOALS.map((g) => (
              <button key={g.value} className={g.value === goal ? "on" : ""} onClick={() => setGoal(g.value)}>{g.label}</button>
            ))}
          </div>
        </div>
        <button className="btn primary big wide" disabled={busy} onClick={() => void host()}>{busy ? "Connecting…" : "Open the world"}</button>
      </section>
    </div>
  );
}

function Lobby(): React.JSX.Element {
  useSyncExternalStore(subscribeNet, netSnapshot);
  const startOnline = useGame((s) => s.startOnline);
  const net = getNet()!;
  const room = net.room;
  const code = net.code ?? "";
  const mine = net.seat;
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState("");

  if (net.error) return <div className="glass online-card"><p className="danger">{net.error}</p></div>;
  if (!room) return <div className="glass online-card"><span className="spinner" /> Entering the room…</div>;

  const scenario = SCENARIOS.find((s) => s.id === room.settings.scenarioId);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this invite link", inviteLink(code));
    }
  };

  return (
    <div className="online-grid">
      <section className="glass online-card">
        <div className="room-code">
          <span className="muted small">Room code</span>
          <b>{code}</b>
          <button className="btn" onClick={() => void copy()}>{copied ? "Link copied ✓" : "Copy invite link"}</button>
        </div>
        <p className="muted small">
          {scenario?.name} · first to {room.settings.winningScore} · {net.people.length} in the room
          {net.isHost ? " · you host" : ""}
        </p>
        <div className="seat-grid">
          {CLASSIC_RULESET.powers.map((p) => {
            const seat = room.seats[String(p.id)];
            const isMine = String(p.id) === mine;
            return (
              <div key={String(p.id)} className={`seat${seat ? " taken" : ""}${isMine ? " mine" : ""}`} style={{ ["--c" as string]: p.color }}>
                <img src={lookOf(String(p.id)).crest} alt="" />
                <div className="seat-body">
                  <b>{p.name}</b>
                  <span>{seat ? `${seat.name}${isMine ? " (you)" : ""}` : "Computer"}</span>
                </div>
                {isMine ? (
                  <button className="btn small ghost" onClick={() => net.release()}>Leave</button>
                ) : !seat ? (
                  <button className="btn small" onClick={() => { net.claim(String(p.id)); sound.play("click"); }}>Take</button>
                ) : null}
              </div>
            );
          })}
        </div>
        {net.isHost ? (
          <button className="btn primary big wide" disabled={mine === null} onClick={startOnline}>Start the game</button>
        ) : (
          <p className="waiting"><span className="spinner" /> Waiting for the host to start…</p>
        )}
        <p className="muted small">Nations nobody takes are played by the computer. If someone drops out, the computer plays for them until they reload or reopen the invite link in the same tab.</p>
      </section>

      <section className="glass online-card chat-card">
        <h2>In the room</h2>
        <ul className="people">{net.people.map((n, i) => <li key={i}>{n}</li>)}</ul>
        <ul className="chat">
          {net.chat.map((l, i) => <li key={i}><b>{l.name}:</b> {l.text}</li>)}
          {net.chat.length === 0 && <li className="muted">Say hello.</li>}
        </ul>
        <form className="join-row" onSubmit={(e) => { e.preventDefault(); net.say(chat); setChat(""); }}>
          <input value={chat} placeholder="Message" onChange={(e) => setChat(e.target.value)} />
          <button className="btn" type="submit">Send</button>
        </form>
      </section>
    </div>
  );
}

export function OnlineScreen(): React.JSX.Element {
  useSyncExternalStore(subscribeNet, netSnapshot);
  const goTitle = useGame((s) => s.goTitle);
  const net = getNet();
  const inRoom = net !== null && net.code !== null;
  return (
    <div className="newgame online">
      <div className="newgame-bg" style={{ backgroundImage: `url(${BASE}art/title-maproom.webp)` }} />
      <header className="newgame-head">
        <button className="btn ghost" onClick={goTitle}>← {inRoom ? "Leave" : "Back"}</button>
        <h1>Play online</h1>
        <span />
      </header>
      <div className="online-body">
        {!onlineAvailable() ? (
          <div className="glass online-card">
            <h2>Online play is not set up in this build</h2>
            <p className="muted">Build with <code>VITE_GAMEHUB_KEY</code> set to the game's GameHub key (see the README).</p>
          </div>
        ) : inRoom ? (
          <Lobby />
        ) : (
          <Entry />
        )}
      </div>
    </div>
  );
}
