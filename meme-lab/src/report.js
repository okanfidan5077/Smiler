// Builds a self-contained, blind rating page from a run's results.

export function renderReport(result) {
  const data = JSON.stringify(result).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meme Lab Ratings</title>
<style>
  :root { --bg:#f6f5f2; --card:#fff; --ink:#1d1d1b; --quiet:#6b6a66; --line:#e2e0da; --accent:#2f6fdb; --good:#2e8b57; --bad:#c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#21211f; --ink:#ecebe7; --quiet:#a3a19b; --line:#34332f; --accent:#6ea0ff; --good:#5cc08a; --bad:#ef7a6c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
  header { position:sticky; top:0; z-index:2; background:var(--bg); border-bottom:1px solid var(--line); padding:12px 16px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
  header h1 { font-size:17px; margin:0 12px 0 0; }
  header label { color:var(--quiet); font-size:14px; }
  button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:8px; padding:4px 10px; cursor:pointer; }
  button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  main { max-width:760px; margin:0 auto; padding:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
  .meta { color:var(--quiet); font-size:13px; margin-bottom:8px; }
  .panel { padding:8px 0; border-top:1px dashed var(--line); }
  .panel:first-of-type { border-top:0; }
  .scene { color:var(--quiet); font-style:italic; font-size:13px; }
  .line b { font-weight:600; }
  .tr { color:var(--quiet); font-style:normal; }
  .rate { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; align-items:center; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .chips button { font-size:13px; }
  textarea { width:100%; margin-top:8px; font:inherit; font-size:14px; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:6px 8px; min-height:38px; }
  .reveal { display:none; margin-top:12px; padding-top:10px; border-top:1px solid var(--line); font-size:13px; color:var(--quiet); }
  body.revealed .reveal { display:block; }
  .cut { opacity:.75; }
  #summary { display:none; }
  body.revealed #summary { display:block; }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); }
  .good { color:var(--good); } .bad { color:var(--bad); }
</style>
</head>
<body>
<header>
  <h1>Meme Lab: blind ratings</h1>
  <label><input type="checkbox" id="showCut"> include critic-cut concepts</label>
  <span id="progress" class="meta" style="margin:0"></span>
  <button id="revealBtn">Reveal models & scores</button>
  <button id="exportBtn">Export ratings</button>
</header>
<main>
  <p class="meta">Rate each meme as a reader: 1 = no reaction, 3 = a smile, 5 = I'd send this to friends. Chips and notes are optional but they teach the writer. Ratings are saved in this browser until you export them.</p>
  <section id="summary" class="card"></section>
  <section id="cards"></section>
</main>
<script>
const RESULT = ${data};
const KEY = "memelab:" + RESULT.started;
const CHIPS = ["not funny", "unclear", "seen it", "weak punchline", "too mean", "wrong format", "too long"];
let ratings = {};
try { ratings = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ratings)); } catch {} };

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const concepts = RESULT.concepts.slice().sort((a, b) => hash(a.id) - hash(b.id));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Optional reader translation (added by src/translate.js), shown in parentheses.
const trText = (s) => (s ? \` <span class="tr">(\${esc(s)})</span>\` : "");

function render() {
  const showCut = document.getElementById("showCut").checked;
  const list = concepts.filter((c) => showCut || c.kept);
  document.getElementById("cards").innerHTML = list.map((c) => {
    const r = ratings[c.id] || {};
    const rv = c.review;
    return \`<article class="card \${c.kept ? "" : "cut"}" data-id="\${c.id}">
      <div class="meta">\${esc(c.sector)} · \${esc(c.format.replace("_", " "))}\${c.layout ? " · " + esc(c.layout) : c.template ? " · " + esc(c.template) : ""}</div>
      \${c.panels.map((p) => \`<div class="panel"><div class="scene">\${esc(p.scene)}\${trText(p.tr?.scene)}</div><div class="line"><b>\${esc(p.speaker)}:</b> \${esc(p.line)}\${trText(p.tr?.line)}</div></div>\`).join("")}
      <div class="rate">\${[1, 2, 3, 4, 5].map((n) => \`<button data-rate="\${n}" class="\${r.rating === n ? "on" : ""}">\${n}</button>\`).join("")}</div>
      <div class="chips">\${CHIPS.map((ch) => \`<button data-chip="\${ch}" class="\${(r.reasons || []).includes(ch) ? "on" : ""}">\${ch}</button>\`).join("")}</div>
      <textarea data-note placeholder="Optional note (what to change, what worked)">\${esc(r.note || "")}</textarea>
      <div class="reveal">
        \${c.invalid ? \`<div class="bad"><b>Invalid, skipped critic:</b> \${esc(c.invalid)}</div>\` : ""}
        <div><b>Model:</b> \${esc(c.config)} · <b>Mechanic:</b> \${esc(c.mechanic)}\${c.explore ? " · <b>experiment</b>" : ""} · <b>Critic:</b> \${rv ? rv.overall + "/10, " + rv.verdict : "n/a"}</div>
        <div><b>Intended:</b> \${esc(c.premise)}\${trText(c.premise_tr)}</div>
        \${rv ? \`<div><b>Weakest:</b> \${esc(rv.weakest_point)} <b>Fix:</b> \${esc(rv.fix)}</div>\` : ""}
        \${c.explain ? \`<div><b>Blind reader:</b> \${esc(c.explain.explanation)} (clarity \${c.explain.clarity}/5\${c.explain.smile ? \`, smile \${c.explain.smile}/5\` : ""})</div>\` : ""}
        \${c.match ? \`<div><b>Got the joke:</b> <span class="\${c.match.match === "no" ? "bad" : "good"}">\${c.match.match}</span>, \${esc(c.match.reason)}</div>\` : ""}
      </div>
    </article>\`;
  }).join("");
  const rated = list.filter((c) => ratings[c.id]?.rating).length;
  document.getElementById("progress").textContent = rated + " / " + list.length + " rated";
  renderSummary();
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function renderSummary() {
  const rows = RESULT.runs.map((run) => {
    const mine = concepts.filter((c) => c.config === run.config);
    const rated = mine.filter((c) => ratings[c.id]?.rating);
    const keptRated = rated.filter((c) => c.kept);
    const avg = (arr) => arr.length ? (arr.reduce((a, c) => a + ratings[c.id].rating, 0) / arr.length).toFixed(2) : "–";
    const hits = keptRated.filter((c) => ratings[c.id].rating >= 4).length;
    const withReview = rated.filter((c) => c.review);
    const r = pearson(withReview.map((c) => c.review.overall), withReview.map((c) => ratings[c.id].rating));
    return \`<tr><td>\${esc(run.config)}</td><td>\${avg(keptRated)}</td><td>\${keptRated.length ? Math.round(100 * hits / keptRated.length) + "%" : "–"}</td><td>\${avg(rated.filter((c) => !c.kept))}</td><td>\${r === null ? "–" : r.toFixed(2)}</td><td>$\${run.usd.toFixed(3)}</td><td>\${run.seconds}s</td></tr>\`;
  }).join("");
  document.getElementById("summary").innerHTML = \`<table><thead><tr><th>Model set</th><th>Avg rating (kept)</th><th>Kept rated 4+</th><th>Avg rating (cut)</th><th>Critic vs you (r)</th><th>Cost</th><th>Time</th></tr></thead><tbody>\${rows}</tbody></table>
  <p class="meta">A good critic gives cut concepts lower ratings than kept ones, and its correlation with you rises toward 1. Rate some cut concepts too, or that check has nothing to measure.</p>\`;
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (!card) return;
  const r = (ratings[card.dataset.id] ||= {});
  if (e.target.dataset.rate) r.rating = Number(e.target.dataset.rate);
  else if (e.target.dataset.chip) {
    const set = new Set(r.reasons || []); const ch = e.target.dataset.chip;
    set.has(ch) ? set.delete(ch) : set.add(ch); r.reasons = [...set];
  } else return;
  save(); render();
});
document.addEventListener("change", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card && e.target.hasAttribute("data-note")) { (ratings[card.dataset.id] ||= {}).note = e.target.value.trim(); save(); }
});
document.getElementById("showCut").addEventListener("change", render);
document.getElementById("revealBtn").addEventListener("click", (e) => {
  document.body.classList.toggle("revealed"); e.target.classList.toggle("on");
});
document.getElementById("exportBtn").addEventListener("click", () => {
  const out = RESULT.concepts.filter((c) => ratings[c.id]?.rating || ratings[c.id]?.note).map((c) => ({
    id: c.id, config: c.config, format: c.format, template: c.template, sector: c.sector, mechanic: c.mechanic,
    premise: c.premise, panels: c.panels, critic: c.review?.overall ?? null, kept: !!c.kept, ...ratings[c.id],
  }));
  const blob = new Blob([JSON.stringify({ started: RESULT.started, ratings: out }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ratings.json"; a.click();
});
render();
</script>
</body>
</html>`;
}
