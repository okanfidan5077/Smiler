import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, callServer, TEXT_CHIPS } from "./supabase.js";

// Text-stage approval: one draft at a time, keyboard first.
//   → / A approve     ← / X reject (1-7 reason chips, Enter confirm, Esc cancel)
//   E edit lines      R new punchline options (1-3 to pick)     N note
//   T Turkish         D details                                 S skip    U undo last
const sorted = (panels) => [...panels].sort((a, b) => a.position - b.position);

export default function Queue() {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("view"); // view | edit | reject | options
  const [edits, setEdits] = useState({}); // position -> line
  const [chips, setChips] = useState([]);
  const [note, setNote] = useState("");
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState("");
  const [tr, setTr] = useState(() => localStorage.getItem("smiler.tr") === "1");
  const [details, setDetails] = useState(false);
  const [last, setLast] = useState(null);
  const noteRef = useRef(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("memes").select("*, panels(*)").eq("status", "draft").order("created_at").limit(100);
    if (error) setError(error.message);
    else setDrafts(data.map((m) => ({ ...m, panels: sorted(m.panels) })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const meme = drafts?.[0];
  const reset = () => { setMode("view"); setEdits({}); setChips([]); setNote(""); setOptions(null); };

  const decide = useCallback(async (decision) => {
    if (!meme || busy) return;
    setBusy(decision);
    try {
      const changed = meme.panels.filter((p) => edits[p.position] !== undefined && edits[p.position] !== p.line);
      for (const p of changed) {
        const { error } = await supabase.from("panels").update({ line: edits[p.position], line_tr: null }).eq("id", p.id);
        if (error) throw error;
      }
      const original = { panels: meme.panels.map(({ speaker, line, scene }) => ({ speaker, line, scene })) };
      const edited = changed.length ? { panels: meme.panels.map(({ speaker, line, scene, position }) => ({ speaker, line: edits[position] ?? line, scene })) } : null;
      const { data: fb, error: fbErr } = await supabase
        .from("feedback")
        .insert({ meme_id: meme.id, stage: "text", decision, reasons: decision === "reject" ? chips : [], note, original, edited })
        .select("id")
        .single();
      if (fbErr) throw fbErr;
      const { error: mErr } = await supabase.from("memes").update({ status: decision === "approve" ? "text_approved" : "rejected" }).eq("id", meme.id);
      if (mErr) throw mErr;
      setLast({ meme, feedbackId: fb.id, changed });
      setDrafts((d) => d.slice(1));
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [meme, busy, edits, chips, note]);

  const undo = useCallback(async () => {
    if (!last || busy) return;
    setBusy("undo");
    try {
      await supabase.from("feedback").delete().eq("id", last.feedbackId);
      for (const p of last.changed) await supabase.from("panels").update({ line: p.line, line_tr: p.line_tr }).eq("id", p.id);
      await supabase.from("memes").update({ status: "draft" }).eq("id", last.meme.id);
      setDrafts((d) => [last.meme, ...d]);
      setLast(null);
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [last, busy]);

  const regenerate = useCallback(async () => {
    if (!meme || busy) return;
    setBusy("punchline");
    try {
      const res = await callServer(`/memes/${meme.id}/punchline`, {});
      setOptions(res);
      setMode("options");
    } catch (err) {
      setError(`Punchline options need the local server (server/, npm start): ${err.message}`);
    } finally {
      setBusy("");
    }
  }, [meme, busy]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = ["TEXTAREA", "INPUT"].includes(e.target.tagName);
      if (e.key === "Escape") { e.target.blur?.(); if (mode !== "edit") reset(); else setMode("view"); return; }
      if (typing) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.blur(); decide("approve"); }
        return;
      }
      if (!meme) return;
      const k = e.key.toLowerCase();
      if (mode === "reject") {
        const n = Number(e.key);
        if (n >= 1 && n <= TEXT_CHIPS.length) setChips((c) => (c.includes(TEXT_CHIPS[n - 1]) ? c.filter((x) => x !== TEXT_CHIPS[n - 1]) : [...c, TEXT_CHIPS[n - 1]]));
        else if (e.key === "Enter") decide("reject");
        else if (k === "n") { e.preventDefault(); noteRef.current?.focus(); }
        return;
      }
      if (mode === "options" && options) {
        const n = Number(e.key);
        if (n >= 1 && n <= options.options.length) { setEdits((x) => ({ ...x, [options.position]: options.options[n - 1] })); setMode("edit"); setOptions(null); }
        return;
      }
      if (e.key === "ArrowRight" || k === "a") decide("approve");
      else if (e.key === "ArrowLeft" || k === "x") setMode("reject");
      else if (k === "e") setMode((m) => (m === "edit" ? "view" : "edit"));
      else if (k === "r") regenerate();
      else if (k === "n") { e.preventDefault(); noteRef.current?.focus(); }
      else if (k === "t") setTr((v) => { localStorage.setItem("smiler.tr", v ? "0" : "1"); return !v; });
      else if (k === "d") setDetails((v) => !v);
      else if (k === "s") { setDrafts((d) => [...d.slice(1), d[0]]); reset(); }
      else if (k === "u") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meme, mode, options, decide, regenerate, undo]);

  if (error) return <div className="pad"><p className="error">{error}</p><button onClick={() => { setError(""); load(); }}>Reload</button></div>;
  if (!drafts) return <p className="muted pad">Loading drafts…</p>;
  if (!meme) {
    return (
      <div className="pad empty">
        <h2>Queue is empty</h2>
        <p className="muted">New drafts arrive with the next n8n run, or start one from Stats.</p>
        {last && <button onClick={undo}>Undo last decision (U)</button>}
        <button onClick={load}>Refresh</button>
      </div>
    );
  }

  const c = meme.critic ?? {};
  return (
    <main className="queue">
      <div className="progress muted">{drafts.length} draft{drafts.length === 1 ? "" : "s"} waiting {last && <>· <button className="link" onClick={undo}>undo last</button></>}</div>
      <article className="card">
        <div className="meta">
          <span>{meme.sector}</span> · <strong>{meme.layout || meme.format}</strong> · <span>{meme.mechanic}</span>
          {/^new:/i.test(meme.layout) ? <span className="badge new">new layout</span> : meme.explore && <span className="badge">experiment</span>}
        </div>
        {/^new:/i.test(meme.layout) && meme.layout_description && (
          <div className="layout-desc muted">Invented layout: {meme.layout_description} Approving adds it to the catalog.</div>
        )}
        {meme.panels.map((p) => (
          <section className="panel" key={p.id}>
            <div className="scene">{tr && p.scene_tr ? p.scene_tr : p.scene}</div>
            <div className="line">
              <span className="speaker">{p.speaker}:</span>{" "}
              {mode === "edit" ? (
                <textarea value={edits[p.position] ?? p.line} onChange={(e) => setEdits((x) => ({ ...x, [p.position]: e.target.value }))} rows={2} />
              ) : (
                <span className={edits[p.position] !== undefined ? "edited" : ""}>{edits[p.position] ?? p.line}</span>
              )}
              {tr && p.line_tr && mode !== "edit" && edits[p.position] === undefined && <div className="tr">{p.line_tr}</div>}
            </div>
          </section>
        ))}

        {mode === "options" && options && (
          <div className="options">
            <div className="muted">New final line, press 1-{options.options.length} (Esc to cancel):</div>
            {options.options.map((o, i) => <button key={i} onClick={() => { setEdits((x) => ({ ...x, [options.position]: o })); setMode("edit"); setOptions(null); }}><kbd>{i + 1}</kbd> {o}</button>)}
          </div>
        )}

        {mode === "reject" && (
          <div className="chips">
            {TEXT_CHIPS.map((ch, i) => (
              <button key={ch} className={chips.includes(ch) ? "on" : ""} onClick={() => setChips((c) => (c.includes(ch) ? c.filter((x) => x !== ch) : [...c, ch]))}>
                <kbd>{i + 1}</kbd> {ch}
              </button>
            ))}
            <button className="danger" onClick={() => decide("reject")}>Reject <kbd>Enter</kbd></button>
          </div>
        )}

        <textarea ref={noteRef} className="note" placeholder="Note (N): what to change, what worked. Ctrl+Enter approves." value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

        <div className="actions">
          <button className="danger" disabled={!!busy} onClick={() => setMode("reject")}><kbd>←</kbd> Reject</button>
          <button disabled={!!busy} onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}><kbd>E</kbd> Edit</button>
          <button disabled={!!busy} onClick={regenerate}><kbd>R</kbd> {busy === "punchline" ? "Writing…" : "Punchline"}</button>
          <button className="primary" disabled={!!busy} onClick={() => decide("approve")}>Approve <kbd>→</kbd></button>
        </div>
        <div className="hints muted"><kbd>T</kbd> Turkish {tr ? "on" : "off"} · <kbd>D</kbd> details · <kbd>S</kbd> skip · <kbd>U</kbd> undo</div>

        {details && (
          <div className="details">
            <div><b>Intended:</b> {meme.premise}{tr && meme.premise_tr && <span className="tr"> ({meme.premise_tr})</span>}</div>
            <div><b>Critic:</b> {c.overall}/10 · instant {c.instant} · tight {c.tight} · picture {c.visual_payoff} · twist {c.twist} · relatable {c.relatable}{c.weakest_point && <> · weakest: {c.weakest_point}</>}</div>
            {meme.explain && <div><b>Blind reader</b> (clarity {meme.explain.clarity}, smile {meme.explain.smile}): {meme.explain.explanation}</div>}
            {meme.match && <div><b>Got the joke:</b> {meme.match.match}, {meme.match.reason}</div>}
          </div>
        )}
      </article>
    </main>
  );
}
