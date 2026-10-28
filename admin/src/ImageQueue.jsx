import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Image-stage approval: drawn memes (status images_ready), shown as the app will show them.
//   → / A approve (ready to publish)
//   ← / X problems: 1-6 chips, Enter = redraw (back to the drawing queue), Shift+Enter = drop meme
//   E edit lines (saved on approve)   N note   T Turkish   D prompts   S skip   U undo   click an image to enlarge
export const IMAGE_CHIPS = ["bad faces/hands", "doesn't match joke", "style off", "cluttered", "characters change", "text in image"];
const byPos = (a, b) => a.position - b.position;

export default function ImageQueue() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("view"); // view | reject | edit
  const [edits, setEdits] = useState({}); // panel position -> line
  const [chips, setChips] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [tr, setTr] = useState(() => localStorage.getItem("smiler.tr") === "1");
  const [details, setDetails] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [last, setLast] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("memes")
      .select("*, panels(*), meme_images(*)")
      .eq("status", "images_ready")
      .order("updated_at")
      .limit(50);
    if (error) setError(error.message);
    else setItems(data.map((m) => ({ ...m, panels: [...m.panels].sort(byPos), meme_images: [...m.meme_images].sort(byPos) })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const meme = items?.[0];
  const reset = () => { setMode("view"); setChips([]); setNote(""); setEdits({}); };

  // decision: approve | redraw | drop
  const decide = useCallback(async (decision) => {
    if (!meme || busy) return;
    setBusy(decision);
    try {
      const status = { approve: "approved", redraw: "text_approved", drop: "rejected" }[decision];
      // Line edits (E) are saved with an approval, like in the text queue.
      const changed = decision === "approve" ? meme.panels.filter((p) => edits[p.position] !== undefined && edits[p.position].trim() !== p.line) : [];
      for (const p of changed) {
        const { error } = await supabase.from("panels").update({ line: edits[p.position].trim(), line_tr: null }).eq("id", p.id);
        if (error) throw error;
      }
      const panelsOut = (useEdits) => meme.panels.map(({ speaker, line, scene, position }) => ({ speaker, line: useEdits ? (edits[position]?.trim() || line) : line, scene }));
      const { data: fb, error: fbErr } = await supabase
        .from("feedback")
        .insert({
          meme_id: meme.id,
          stage: "image",
          decision: decision === "approve" ? "approve" : "reject",
          reasons: decision === "approve" ? [] : chips,
          note: decision === "drop" ? `[dropped] ${note}`.trim() : note,
          original: { images: meme.meme_images.map(({ url, prompt, seed }) => ({ url, prompt, seed })), panels: panelsOut(false) },
          edited: changed.length ? { panels: panelsOut(true) } : null,
        })
        .select("id")
        .single();
      if (fbErr) throw fbErr;
      const { error: mErr } = await supabase.from("memes").update({ status }).eq("id", meme.id);
      if (mErr) throw mErr;
      setLast({ meme, feedbackId: fb.id, changed });
      setItems((d) => d.slice(1));
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [meme, busy, chips, note, edits]);

  const undo = useCallback(async () => {
    if (!last || busy) return;
    setBusy("undo");
    try {
      await supabase.from("feedback").delete().eq("id", last.feedbackId);
      for (const p of last.changed ?? []) await supabase.from("panels").update({ line: p.line, line_tr: p.line_tr }).eq("id", p.id);
      await supabase.from("memes").update({ status: "images_ready" }).eq("id", last.meme.id);
      setItems((d) => [last.meme, ...d]);
      setLast(null);
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [last, busy]);

  useEffect(() => {
    const onKey = (e) => {
      if (zoom) { if (e.key === "Escape" || e.key === " ") setZoom(null); return; }
      const typing = ["TEXTAREA", "INPUT"].includes(e.target.tagName);
      if (e.key === "Escape") { e.target.blur?.(); if (mode === "edit") setMode("view"); else reset(); return; }
      if (typing) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.blur(); decide(mode === "reject" ? "redraw" : "approve"); }
        return;
      }
      if (!meme) return;
      const k = e.key.toLowerCase();
      if (mode === "reject") {
        const n = Number(e.key);
        if (n >= 1 && n <= IMAGE_CHIPS.length) setChips((c) => (c.includes(IMAGE_CHIPS[n - 1]) ? c.filter((x) => x !== IMAGE_CHIPS[n - 1]) : [...c, IMAGE_CHIPS[n - 1]]));
        else if (e.key === "Enter") decide(e.shiftKey ? "drop" : "redraw");
        else if (k === "n") { e.preventDefault(); document.querySelector(".note")?.focus(); }
        return;
      }
      if (e.key === "ArrowRight" || k === "a") decide("approve");
      else if (e.key === "ArrowLeft" || k === "x") setMode("reject");
      else if (k === "e") { e.preventDefault(); setMode((m) => (m === "edit" ? "view" : "edit")); }
      else if (k === "n") { e.preventDefault(); document.querySelector(".note")?.focus(); }
      else if (k === "t") setTr((v) => { localStorage.setItem("smiler.tr", v ? "0" : "1"); return !v; });
      else if (k === "d") setDetails((v) => !v);
      else if (k === "s") { setItems((d) => [...d.slice(1), d[0]]); reset(); }
      else if (k === "u") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meme, mode, zoom, decide, undo]);

  if (error) return <div className="pad"><p className="error">{error}</p><button onClick={() => { setError(""); load(); }}>Reload</button></div>;
  if (!items) return <p className="muted pad">Loading drawn memes…</p>;
  if (!meme) {
    return (
      <div className="pad empty">
        <h2>No drawn memes waiting</h2>
        <p className="muted">Approved jokes get drawn with "Draw images now" under Stats (ComfyUI must be running).</p>
        {last && <button onClick={undo}>Undo last decision (U)</button>}
        <button onClick={load}>Refresh</button>
      </div>
    );
  }

  const line = (p) => (
    <div className="line small-line">
      <span className="speaker">{p.speaker}:</span>{" "}
      {mode === "edit" ? (
        <textarea value={edits[p.position] ?? p.line} onChange={(e) => setEdits((x) => ({ ...x, [p.position]: e.target.value }))} rows={2} />
      ) : (
        <span className={edits[p.position] !== undefined && edits[p.position] !== p.line ? "edited" : ""}>{edits[p.position] ?? p.line}</span>
      )}
      {tr && p.line_tr && mode !== "edit" && edits[p.position] === undefined && <div className="tr">{p.line_tr}</div>}
    </div>
  );
  const imgs = meme.meme_images;
  // Recast templates: labels sit on their characters (art.labels), as the app will draw them;
  // captions stay below. Multi-panel memes pair image N with line N. Otherwise lines go below.
  const labels = meme.format === "recast_template" ? meme.art?.labels ?? [] : [];
  const placed = new Set(labels.map((l) => l.position));
  const paired = meme.format === "multi_panel";
  const below = meme.panels.filter((p) => !placed.has(p.position));
  const labelText = (pos) => {
    const p = meme.panels.find((x) => x.position === pos);
    return p ? (edits[pos] ?? p.line) : "";
  };

  return (
    <main className="queue wide">
      <div className="progress muted">{items.length} drawn meme{items.length === 1 ? "" : "s"} waiting {last && <>· <button className="link" onClick={undo}>undo last</button></>}</div>
      <article className="card">
        <div className="meta"><span>{meme.sector}</span> · <strong>{meme.layout}</strong> · <span>{meme.format.replace("_", " ")}</span></div>
        <div className="frames">
          {imgs.map((im, i) => (
            <figure key={im.id}>
              <div className="frame">
                <img src={im.url} alt={`panel ${i + 1}`} onClick={() => setZoom(im.url)} />
                {labels.filter((l) => l.image === i + 1).map((l) => (
                  <span key={l.position} className="label-tag" style={{ left: `${l.x}%`, top: `${l.y}%` }}>{labelText(l.position)}</span>
                ))}
              </div>
              {paired && meme.panels[i] && line(meme.panels[i])}
            </figure>
          ))}
        </div>
        {!paired && below.length > 0 && <div className="caption-block">{below.map((p) => <div key={p.id}>{line(p)}</div>)}</div>}
        {labels.length > 0 && mode === "edit" && (
          <div className="caption-block muted">Labels on the image: {meme.panels.filter((p) => placed.has(p.position)).map((p) => <div key={p.id}>{line(p)}</div>)}</div>
        )}

        {mode === "reject" && (
          <div className="chips">
            {IMAGE_CHIPS.map((ch, i) => (
              <button key={ch} className={chips.includes(ch) ? "on" : ""} onClick={() => setChips((c) => (c.includes(ch) ? c.filter((x) => x !== ch) : [...c, ch]))}><kbd>{i + 1}</kbd> {ch}</button>
            ))}
            <button onClick={() => decide("redraw")}>Redraw <kbd>Enter</kbd></button>
            <button className="danger" onClick={() => decide("drop")}>Drop meme <kbd>Shift+Enter</kbd></button>
          </div>
        )}

        <textarea className="note" placeholder="Note (N): what to change in the picture. Ctrl+Enter approves (or redraws while rejecting)." value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <div className="actions">
          <button className="danger" disabled={!!busy} onClick={() => setMode("reject")}><kbd>←</kbd> Problems</button>
          <button disabled={!!busy} onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}><kbd>E</kbd> Edit lines</button>
          <button className="primary" disabled={!!busy} onClick={() => decide("approve")}>Approve <kbd>→</kbd></button>
        </div>
        <div className="hints muted"><kbd>T</kbd> Turkish {tr ? "on" : "off"} · <kbd>D</kbd> prompts · <kbd>S</kbd> skip · <kbd>U</kbd> undo · click an image to enlarge</div>

        {details && (
          <div className="details">
            <div><b>Joke:</b> {meme.premise}</div>
            {meme.art?.cast && <div><b>Cast:</b> {meme.art.cast.map((c) => `${c.role}: ${c.look}`).join(" · ")}</div>}
            {imgs.map((im, i) => <div key={im.id}><b>Image {i + 1}</b> ({im.model?.includes("edit") ? "edit from 1" : "text to image"}, seed {im.seed}): {im.prompt}</div>)}
          </div>
        )}
      </article>
      {zoom && <div className="zoom" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
    </main>
  );
}
