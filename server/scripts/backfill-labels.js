// Places labels on recast memes that were drawn before label placement existed (Gemma only, no
// redraw). Safe to re-run: memes that already have art.labels are skipped unless --force.
//
//   node scripts/backfill-labels.js [--force]

import { db, must } from "../src/db.js";
import { loadConfig } from "../src/text-run.js";
import { placeLabels } from "../src/images/labels.js";

const force = process.argv.includes("--force");
const anchorsOf = new Map(must(await db.from("layouts").select("name, anchors").not("anchors", "is", null), "anchors").map((l) => [l.name, l.anchors]));
const memes = must(
  await db.from("memes").select("id, layout, art, panels(position, speaker, line)").eq("format", "recast_template").in("status", ["images_ready", "approved", "published"]),
  "recast memes",
);
const writer = loadConfig().writer;
let done = 0;
for (const m of memes) {
  if (m.art?.labels?.length && !force) continue;
  const anchors = anchorsOf.get(m.layout);
  if (!anchors) { console.log(`skip ${m.layout} (no anchors)`); continue; }
  const labels = await placeLabels(writer, m, anchors);
  must(await db.from("memes").update({ art: { ...(m.art ?? {}), labels } }).eq("id", m.id), "store labels");
  console.log(`${m.layout}: ${labels.map((l) => `${m.panels.find((p) => p.position === l.position)?.speaker} -> image ${l.image} (${l.x}%, ${l.y}%)`).join(" | ")}`);
  done++;
}
console.log(`labels placed on ${done} memes`);
await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/generate`, { method: "POST", body: JSON.stringify({ model: writer.model, keep_alive: 0 }) }).catch(() => {});
