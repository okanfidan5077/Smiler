import { useCallback, useEffect, useState } from "react";
import { supabase, callServer } from "./supabase.js";

const STATUSES = ["draft", "text_approved", "images_ready", "approved", "published", "rejected"];

export default function Stats() {
  const [counts, setCounts] = useState({});
  const [decisions, setDecisions] = useState({ approve: 0, reject: 0 });
  const [layouts, setLayouts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [server, setServer] = useState(null); // null unknown, false offline, { running }
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const c = {};
    await Promise.all(STATUSES.map(async (s) => {
      const { count } = await supabase.from("memes").select("id", { count: "exact", head: true }).eq("status", s);
      c[s] = count ?? 0;
    }));
    setCounts(c);
    const { data: fb } = await supabase.from("latest_feedback").select("decision").eq("stage", "text").limit(5000);
    setDecisions({ approve: fb?.filter((f) => f.decision === "approve").length ?? 0, reject: fb?.filter((f) => f.decision === "reject").length ?? 0 });
    const { data: ls } = await supabase.from("layout_scores").select("*").eq("active", true).order("score", { ascending: false });
    setLayouts(ls ?? []);
    const { data: rs } = await supabase.from("generation_runs").select("*").order("started_at", { ascending: false }).limit(10);
    setRuns(rs ?? []);
    try { setServer(await callServer("/runs/current")); } catch { setServer(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // While a run is going, check every 15 seconds.
  useEffect(() => {
    if (!server?.running) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [server, load]);

  const generate = async () => {
    setError("");
    try {
      await callServer("/runs/text", { wait: false });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const total = decisions.approve + decisions.reject;
  const scored = layouts.filter((l) => Number(l.up) + Number(l.down) > 0);
  return (
    <main className="stats pad">
      <section className="tiles">
        <Tile label="Waiting for text approval" value={counts.draft} />
        <Tile label="Text approved (backlog for images)" value={counts.text_approved} />
        <Tile label="Approval rate" value={total ? `${Math.round((100 * decisions.approve) / total)}%` : "–"} sub={`${decisions.approve} of ${total} decisions`} />
        <Tile label="Rejected" value={counts.rejected} />
      </section>

      <section>
        <h2>Generate</h2>
        {server === false && <p className="muted">The local server is offline. Start it with <code>npm start</code> in <code>server/</code>.</p>}
        {server?.running && <p>A run started at {new Date(server.started).toLocaleTimeString()} is in progress (about 5 minutes).</p>}
        {server && !server.running && <button className="primary" onClick={generate}>Generate 12 drafts now</button>}
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h2>Layout scores <span className="muted">({scored.length} of {layouts.length} have ratings; score = (up+1)/(up+down+2))</span></h2>
        <table>
          <thead><tr><th>Layout</th><th>Format</th><th>Up</th><th>Down</th><th>Your decisions</th><th>Score</th></tr></thead>
          <tbody>
            {layouts.map((l) => (
              <tr key={l.name} className={Number(l.up) + Number(l.down) === 0 ? "muted" : ""}>
                <td>{l.name}</td><td>{l.format.replace("_", " ")}</td><td>{Number(l.up)}</td><td>{Number(l.down)}</td><td>{l.decisions}</td>
                <td><span className="bar" style={{ "--w": `${Math.round(Number(l.score) * 100)}%` }} />{Number(l.score).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Recent runs</h2>
        <table>
          <thead><tr><th>Started</th><th>Status</th><th>Written</th><th>Passed gate</th><th>Drafts</th><th>Time</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString()}</td><td>{r.status}</td><td>{r.stats?.written ?? "–"}</td>
                <td>{r.stats?.passed ?? "–"}</td><td>{r.stats?.drafts ?? "–"}</td><td>{r.stats?.seconds ? `${Math.round(r.stats.seconds / 60)} min` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <button onClick={load}>Refresh</button>
    </main>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <div className="value">{value ?? "–"}</div>
      <div className="label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}
