import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Image-stage approval: drawn memes (status images_ready), shown as the app will show them.
//   → / A approve (ready to publish)
//   ← / X problems: 1-6 chips, Enter = redraw (back to the drawing queue), Shift+Enter = drop meme
//   N note   T Turkish   D prompts   S skip   U undo   click an image to enlarge
export const IMAGE_CHIPS = ["bad faces/hands", "doesn't match joke", "style off", "cluttered", "characters change", "text in image"];
const byPos = (a, b) => a.position - b.position;

export default function ImageQueue() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("view"); // view | reject
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
  const reset = () => { setMode("view"); setChips([]); setNote(""); };

  // decision: approve | redraw | drop
  const decide = useCallback(async (decision) => {
    if (!meme || busy) return;
    setBusy(decision);
    try {
      const status = { approve: "approved", redraw: "text_approved", drop: "rejected" }[decision];
      const { data: fb, error: fbErr } = await supabase
        .from("feedback")
        .insert({
          meme_id: meme.id,
          stage: "image",
          decision: decision === "approve" ? "approve" : "reject",
          reasons: decision === "approve" ? [] : chips,
          note: decision === "drop" ? `[dropped] ${note}`.trim() : note,
          original: { images: meme.meme_images.map(({ url, prompt, seed }) => ({ url, prompt, seed })) },
        })
        .select("id")
        .single();
      if (fbErr) throw fbErr;
      const { error: mErr } = await supabase.from("memes").update({ status }).eq("id", meme.id);
      if (mErr) throw mErr;
      setLast({ meme, feedbackId: fb.id });
      setItems((d) => d.slice(1));
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [meme, busy, chips, note]);

  const undo = useCallback(async () => {
    if (!last || busy) return;
    setBusy("undo");
    try {
      await supabase.from("feedback").delete().eq("id", last.feedbackId);
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
      if (e.key === "Escape") { e.target.blur?.(); reset(); return; }
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
      <span className="speaker">{p.speaker}:</span> {p.line}
      {tr && p.line_tr && <div className="tr">{p.line_tr}</div>}
    </div>
  );
  const imgs = meme.meme_images;
  // Multi-panel memes, and recasts whose labels match their images, pair image N with line N;
  // otherwise the image(s) come first and all lines (caption or labels) below, as the app shows them.
  const paired = meme.format === "multi_panel" || (meme.format === "recast_template" && imgs.length === meme.panels.length && imgs.length > 1);

  return (
    <main className="queue wide">
      <div className="progress muted">{items.length} drawn meme{items.length === 1 ? "" : "s"} waiting {last && <>· <button className="link" onClick={undo}>undo last</button></>}</div>
      <article className="card">
        <div className="meta"><span>{meme.sector}</span> · <strong>{meme.layout}</strong> · <span>{meme.format.replace("_", " ")}</span></div>
        <div className="frames">
          {imgs.map((im, i) => (
            <figure key={im.id}>
              <img src={im.url} alt={`panel ${i + 1}`} onClick={() => setZoom(im.url)} />
              {paired && meme.panels[i] && line(meme.panels[i])}
            </figure>
          ))}
        </div>
        {!paired && <div className="caption-block">{meme.panels.map((p) => <div key={p.id}>{line(p)}</div>)}</div>}

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
