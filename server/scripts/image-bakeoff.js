// Image bake-off: draws approved memes with each candidate and builds a blind comparison page.
//
//   node scripts/image-bakeoff.js [--memes 5] [--candidates qwen,flux] [--plan bakeoff/<dir>/plan.json]
//
// 1. Gemma art-directs every meme (cast sheet + one prompt per image), then is unloaded.
// 2. ComfyUI renders, grouped by model so models load once: Qwen-Image panel 1s, then
//    Qwen-Image-Edit panels 2-4 from panel 1, then FLUX.1 dev (every panel from its prompt).
// 3. bakeoff/<timestamp>/report.html: blind side-by-side rating page with export.
// ComfyUI must be running (COMFY_URL, default http://127.0.0.1:8188).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { db, must, loadImageNotes } from "../src/db.js";
import { repoRoot } from "../src/env.js";
import { loadConfig } from "../src/text-run.js";
import { artDirect, imageCount } from "../src/images/art-director.js";
import { comfyUp, render } from "../src/images/comfy.js";
import { fluxText2Image } from "../src/images/workflows.js";
import { drawJobs } from "../src/images/draw.js";
import { STYLE, NEGATIVE, EDIT_PREFIX } from "../src/images/style.js";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const memeCount = Number(opt("memes", 5));
const candidates = opt("candidates", "qwen,flux").split(",");
const log = (s) => console.log(`${new Date().toTimeString().slice(0, 8)} ${s}`);

const outDir = opt("plan") ? path.dirname(path.resolve(opt("plan"))) : path.join(repoRoot, "server/bakeoff", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
fs.mkdirSync(outDir, { recursive: true });
const planFile = path.join(outDir, "plan.json");

// ---------- 1. pick approved memes and art-direct them ----------
let plan;
if (fs.existsSync(planFile)) {
  plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  log(`reusing ${planFile}`);
} else {
  const fields = "id, format, layout, template, sector, premise, panels(position, speaker, line, line_tr, scene)";
  const ids = opt("ids", "").split(",").filter(Boolean);
  const approved = must(
    ids.length
      ? await db.from("memes").select(fields).in("id", ids)
      : await db.from("memes").select(fields).eq("status", "text_approved").order("created_at", { ascending: false }).limit(200),
    "approved memes",
  );
  if (!approved.length) throw new Error("no text_approved memes yet; approve some in the admin page first");
  // A mix of formats: multi-panel memes test consistency, singles and recasts test one strong picture.
  const shuffled = approved.sort(() => Math.random() - 0.5);
  const want = { multi_panel: Math.ceil(memeCount / 2), single: Math.max(1, Math.floor(memeCount / 4)), recast_template: Math.max(1, Math.floor(memeCount / 4)) };
  const picked = ids.length ? shuffled : [];
  if (!ids.length) {
    for (const [format, n] of Object.entries(want)) picked.push(...shuffled.filter((m) => m.format === format).slice(0, n));
    for (const m of shuffled) if (picked.length < memeCount && !picked.includes(m)) picked.push(m);
  }
  const compositions = new Map(must(await db.from("layouts").select("name, composition").not("composition", "is", null), "layout blueprints").map((l) => [l.name, l.composition]));
  const writer = loadConfig().writer;
  const imageNotes = await loadImageNotes();
  plan = { started: new Date().toISOString(), style: STYLE, negative: NEGATIVE, memes: [] };
  const chosen = picked.slice(0, ids.length || memeCount);
  for (const [i, m] of chosen.entries()) {
    const comp = compositions.get(m.layout) ?? null;
    log(`art direction ${i + 1}/${chosen.length}: ${m.layout} (${m.format}, ${imageCount(m, comp)} image${imageCount(m, comp) > 1 ? "s" : ""}${comp ? ", blueprint" : ""})`);
    const art = await artDirect(writer, m, comp, imageNotes.forMeme(m.id));
    plan.memes.push({ ...m, panels: [...m.panels].sort((a, b) => a.position - b.position), art, seed: Math.floor(Math.random() * 2 ** 32), renders: {} });
  }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  // VRAM sequencing: free the GPU from Gemma before the image models load.
  await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/generate`, { method: "POST", body: JSON.stringify({ model: loadConfig().writer.model, keep_alive: 0 }) }).catch(() => {});
}

// ---------- 2. render ----------
if (!(await comfyUp())) throw new Error("ComfyUI is not running on 127.0.0.1:8188");
const save = () => fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
const file = (mi, cand, k) => `m${mi + 1}_${cand}_${k + 1}.png`;
async function draw(mi, cand, k, graph) {
  const name = file(mi, cand, k);
  const target = path.join(outDir, name);
  if (fs.existsSync(target)) return target;
  const t0 = Date.now();
  const [png] = await render(graph);
  fs.writeFileSync(target, png);
  const r = (plan.memes[mi].renders[cand] ??= { files: [], seconds: [] });
  r.files[k] = name;
  r.seconds[k] = Math.round((Date.now() - t0) / 1000);
  save();
  log(`  ${name} ${r.seconds[k]}s`);
  return target;
}
const prompt = (m, k) => `${STYLE} ${m.art.images[k].prompt}`;

if (candidates.includes("qwen")) {
  // Same drawing code as the service (cast sheet + panels for multi-image memes).
  const todo = plan.memes.map((m, mi) => ({ mi, meme: m, art: m.art, seed: m.seed })).filter((j) => !fs.existsSync(path.join(outDir, file(j.mi, "qwen", 0))));
  const t0 = Date.now();
  await drawJobs(todo, (s) => log(`  ${s.trim()}`));
  for (const j of todo) {
    if (j.failed) { log(`  FAILED m${j.mi + 1}: ${j.error.step}: ${j.error.message}`); continue; }
    if (j.castPng) fs.writeFileSync(path.join(outDir, `m${j.mi + 1}_qwen_cast.png`), j.castPng);
    const r = (plan.memes[j.mi].renders.qwen = { files: [], seconds: [], cast: j.castPng ? `m${j.mi + 1}_qwen_cast.png` : null });
    j.pngs.forEach((png, k) => {
      r.files[k] = file(j.mi, "qwen", k);
      fs.writeFileSync(path.join(outDir, r.files[k]), png);
    });
    r.seconds = [Math.round((Date.now() - t0) / 1000 / todo.length)];
  }
  save();
}
if (candidates.includes("flux")) {
  log("FLUX.1 dev (fixed): every image from its prompt");
  for (const [mi, m] of plan.memes.entries()) {
    for (let k = 0; k < m.art.images.length; k++) await draw(mi, "flux", k, fluxText2Image({ prompt: prompt(m, k), seed: m.seed }));
  }
}

// ---------- 3. blind comparison page ----------
// Images are embedded as JPEG data URIs so the page works as a single file (sent to the user,
// opened from OneDrive, ...). ComfyUI's Python has Pillow for the PNG -> JPEG conversion.
const python = process.env.COMFY_PYTHON ?? "C:/AI_TOOLS/ComfyUI/ComfyUI/venv/Scripts/python.exe";
const convert = spawnSync(python, ["-c", `
import sys, glob, os
from PIL import Image
for p in glob.glob(os.path.join(sys.argv[1], "*.png")):
    j = p[:-4] + ".jpg"
    if not os.path.exists(j):
        Image.open(p).convert("RGB").save(j, "JPEG", quality=88, optimize=True)
`, outDir], { encoding: "utf8" });
if (convert.status !== 0) throw new Error(`JPEG conversion failed: ${convert.stderr || convert.error}`);
const embed = (name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(outDir, name.replace(/\.png$/, ".jpg"))).toString("base64")}`;
fs.writeFileSync(path.join(outDir, "report.html"), renderReport(plan, candidates, embed));
log(`report: ${path.join(outDir, "report.html")} (${(fs.statSync(path.join(outDir, "report.html")).size / 1e6).toFixed(1)} MB, images embedded)`);

function renderReport(plan, cands, embed) {
  const memes = plan.memes.map(({ id, format, layout, sector, premise, panels, art, renders }) => ({
    id, format, layout, sector, premise, panels, art,
    renders: Object.fromEntries(Object.entries(renders).map(([c, r]) => [c, { ...r, files: r.files.map(embed) }])),
  }));
  const data = JSON.stringify({ started: plan.started, candidates: cands, memes }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Image Bake-off</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e2e0da;--accent:#2f6fdb}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#21211f;--ink:#ecebe7;--muted:#a3a19b;--line:#34332f;--accent:#6ea0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
header h1{font-size:17px;margin:0}main{max-width:1200px;margin:0 auto;padding:16px}
button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer}button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.meme{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:20px}
.lines{color:var(--muted);font-size:14px;margin-bottom:10px}.lines b{color:var(--ink)}
.cand{border-top:1px dashed var(--line);padding-top:12px;margin-top:12px}.cand h3{margin:0 0 8px;font-size:15px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.strip figure{margin:0}.strip img{width:100%;border-radius:8px;border:1px solid var(--line);cursor:zoom-in}
.strip figcaption{font-size:14px;margin-top:4px}.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
textarea{width:100%;margin-top:6px;font:inherit;font-size:14px;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px}
.reveal{display:none;font-size:13px;color:var(--muted);margin-top:6px}body.revealed .reveal{display:block}
.zoom{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:9}.zoom img{max-width:95vw;max-height:95vh}
</style></head><body>
<header><h1>Image bake-off</h1><span class="muted" id="progress"></span><button id="revealBtn">Reveal models</button><button id="exportBtn">Export ratings</button></header>
<main><p class="lines">Rate each set of images as a reader: does the picture land the joke, look good, and keep the same characters across panels? 1 = unusable, 3 = fine, 5 = great. Model names are hidden until Reveal.</p><div id="list"></div></main>
<div class="zoom" id="zoom"><img alt=""></div>
<script>
const D=${data};
const CHIPS=["bad faces/hands","doesn't match joke","style off","cluttered","characters change","text in image"];
const KEY="bakeoff:"+D.started;let R={};try{R=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(R))}catch{}};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hash=s=>{let h=2166136261;for(const ch of s)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0};
function render(){
  document.getElementById("list").innerHTML=D.memes.map((m,mi)=>{
    const order=D.candidates.filter(c=>m.renders[c]).sort((a,b)=>hash(m.id+a)-hash(m.id+b));
    const lines=m.panels.map(p=>"<div><b>"+esc(p.speaker)+":</b> "+esc(p.line)+(p.line_tr?" <i>("+esc(p.line_tr)+")</i>":"")+"</div>").join("");
    return '<section class="meme"><div class="lines">'+esc(m.sector)+" · "+esc(m.layout)+" · "+esc(m.format.replace("_"," "))+lines+"</div>"+order.map((c,ci)=>{
      const k=m.id+"|"+c,r=R[k]||{};const files=m.renders[c].files;
      const figs=files.map((f,i)=>{const cap=m.format==="multi_panel"?m.panels[i]:(i===0?null:null);return '<figure><img src="'+esc(f)+'" loading="lazy" alt="">'+(cap?'<figcaption><b>'+esc(cap.speaker)+':</b> '+esc(cap.line)+'</figcaption>':'')+'</figure>'}).join("");
      return '<div class="cand" data-k="'+esc(k)+'"><h3>Option '+"AB"[ci]+'</h3><div class="strip">'+figs+'</div><div class="row">'+[1,2,3,4,5].map(n=>'<button data-rate="'+n+'" class="'+(r.rating===n?"on":"")+'">'+n+'</button>').join("")+"</div>"+
        '<div class="row">'+CHIPS.map(ch=>'<button data-chip="'+esc(ch)+'" class="'+((r.reasons||[]).includes(ch)?"on":"")+'">'+esc(ch)+"</button>").join("")+'</div><textarea data-note placeholder="Note (optional)">'+esc(r.note||"")+'</textarea><div class="reveal"><b>'+esc(c)+"</b> · "+(m.renders[c].seconds||[]).join("s, ")+"s per image</div></div>";
    }).join("")+'<div class="reveal"><b>Image prompts:</b> '+m.art.images.map((im,i)=>(i+1)+". "+esc(im.prompt)).join(" ")+"</div></section>";
  }).join("");
  const total=D.memes.reduce((n,m)=>n+D.candidates.filter(c=>m.renders[c]).length,0);
  document.getElementById("progress").textContent=Object.values(R).filter(r=>r.rating).length+" / "+total+" rated";
}
document.getElementById("list").addEventListener("click",e=>{
  const img=e.target.closest("img");if(img){const z=document.getElementById("zoom");z.firstElementChild.src=img.src;z.style.display="flex";return}
  const card=e.target.closest(".cand");if(!card)return;const k=card.dataset.k;const r=R[k]=R[k]||{};
  if(e.target.dataset.rate){r.rating=Number(e.target.dataset.rate);save();render()}
  else if(e.target.dataset.chip){const ch=e.target.dataset.chip;r.reasons=(r.reasons||[]).includes(ch)?r.reasons.filter(x=>x!==ch):[...(r.reasons||[]),ch];save();render()}
});
document.getElementById("list").addEventListener("input",e=>{if(e.target.dataset.note===undefined)return;const k=e.target.closest(".cand").dataset.k;(R[k]=R[k]||{}).note=e.target.value;save()});
document.getElementById("zoom").addEventListener("click",e=>e.currentTarget.style.display="none");
document.getElementById("revealBtn").onclick=()=>{document.body.classList.toggle("revealed");summary()};
function summary(){const s={};for(const[k,r]of Object.entries(R)){if(!r.rating)continue;const c=k.split("|")[1];(s[c]=s[c]||[]).push(r.rating)}
  const t=Object.entries(s).map(([c,v])=>c+": "+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2)+" (n "+v.length+")").join(" · ");document.getElementById("progress").textContent=t||"no ratings yet"}
document.getElementById("exportBtn").onclick=()=>{const out={started:D.started,ratings:Object.entries(R).map(([k,r])=>({meme_id:k.split("|")[0],candidate:k.split("|")[1],...r}))};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));a.download="image-ratings.json";a.click()};
render();
</script></body></html>`;
}
