// Imports memes the user rated 4-5 in the meme-lab blind rounds into Supabase as approved
// ('text_approved', source 'meme-lab'), so they join the backlog for images and the feed.
// Safe to re-run: lab_key makes it skip what is already imported, and identical texts are skipped.
//
//   node scripts/import-lab.js path/to/ratings.json [more ratings.json ...] [--min 4]
//
// Needs the runs in meme-lab/results (only on the PC that ran them) for scenes and translations.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, must } from "../src/db.js";
import { repoRoot } from "../src/env.js";

const argv = process.argv.slice(2);
const min = argv.includes("--min") ? Number(argv[argv.indexOf("--min") + 1]) : 4;
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--min");

const resultsDir = path.join(repoRoot, "meme-lab/results");
const runs = {};
for (const d of fs.readdirSync(resultsDir)) {
  const f = path.join(resultsDir, d, "results.json");
  if (fs.existsSync(f)) {
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    runs[r.started] = r;
  }
}

const textKey = (panels) => panels.map((p) => p.line.trim().toLowerCase()).join(" / ");
const existing = must(await db.from("memes").select("lab_key, panels(position, line)").in("status", ["text_approved", "images_ready", "approved", "published"]), "existing memes");
const seenKeys = new Set(existing.map((m) => m.lab_key).filter(Boolean));
const seenTexts = new Set(existing.map((m) => textKey([...m.panels].sort((a, b) => a.position - b.position))));

const memes = [];
const panels = [];
let skipped = 0, missing = 0;
for (const file of files) {
  const { started, ratings } = JSON.parse(fs.readFileSync(file, "utf8"));
  const run = runs[started];
  if (!run) {
    console.warn(`skipping ${path.basename(file)}: run ${started} not in meme-lab/results`);
    continue;
  }
  const byId = new Map(run.concepts.map((c) => [c.id, c]));
  for (const r of ratings.filter((r) => (r.rating ?? 0) >= min)) {
    const c = byId.get(r.id);
    const key = `${started}/${r.id}`;
    if (!c) { missing++; continue; }
    const text = textKey(c.panels);
    if (seenKeys.has(key) || seenTexts.has(text)) { skipped++; continue; }
    seenKeys.add(key);
    seenTexts.add(text);
    const id = crypto.randomUUID();
    memes.push({
      id,
      status: "text_approved",
      source: "meme-lab",
      lab_key: key,
      lab_rating: r.rating,
      lab_note: r.note ?? "",
      writer: c.config,
      format: c.format,
      layout: c.layout ?? (c.template || c.format),
      layout_description: c.layout_description ?? "",
      template: c.template ?? "",
      sector: c.seed?.sector ?? c.sector ?? "",
      problem: c.problem ?? "",
      mechanic: c.mechanic ?? c.seed?.mechanic ?? "",
      explore: !!c.explore,
      premise: c.premise ?? "",
      premise_tr: c.premise_tr ?? null,
      critic: c.review ?? null,
      explain: c.explain ?? null,
      match: c.match ?? null,
      gate_passed: c.passed ?? null,
      created_at: started,
    });
    c.panels.slice(0, 5).forEach((p, i) =>
      panels.push({ meme_id: id, position: i + 1, speaker: p.speaker, line: p.line, scene: p.scene, line_tr: p.tr?.line ?? null, scene_tr: p.tr?.scene ?? null }),
    );
  }
}

if (memes.length) {
  must(await db.from("memes").insert(memes), "insert memes");
  must(await db.from("panels").insert(panels), "insert panels");
}
const byWriter = memes.reduce((a, m) => ((a[m.writer] = (a[m.writer] ?? 0) + 1), a), {});
console.log(`imported ${memes.length} memes rated >= ${min} (${JSON.stringify(byWriter)}); skipped ${skipped} already present or duplicate text; ${missing} not found in their run`);
