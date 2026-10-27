// Backs up what matters in Supabase to one JSON file per day: every reviewed meme (approved,
// rejected, drafts, with panels and translations), all decisions with notes and edits, the
// layout catalog with scores, and run summaries. Candidates are skipped (they can be regenerated).
//
//   node scripts/backup.js [--dir <folder>]
//
// Default folder: %OneDrive%\SmilerBackups (OneDrive syncs it), else <repo>/backups (git-ignored).
// start-review.cmd runs this at the start of every review session.

import fs from "node:fs";
import path from "node:path";
import { db, must } from "../src/db.js";
import { repoRoot } from "../src/env.js";

const argv = process.argv.slice(2);
const dir = argv.includes("--dir")
  ? argv[argv.indexOf("--dir") + 1]
  : process.env.OneDrive
    ? path.join(process.env.OneDrive, "SmilerBackups")
    : path.join(repoRoot, "backups");
fs.mkdirSync(dir, { recursive: true });

// PostgREST returns at most 1000 rows per request, so page through.
async function all(table, select, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await filter(db.from(table).select(select)).order("created_at", { ascending: true }).range(from, from + 999), table);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const memes = await all("memes", "*, panels(*)", (q) => q.neq("status", "candidate"));
for (const m of memes) {
  m.panels.sort((a, b) => a.position - b.position);
  delete m.embedding;
}
const feedback = await all("feedback", "*");
const layouts = await all("layouts", "*");
const scores = must(await db.from("layout_scores").select("*"), "layout_scores");
const runs = must(await db.from("generation_runs").select("id, kind, status, params, stats, cost_usd, started_at, finished_at").order("started_at"), "runs");

const snapshot = { taken_at: new Date().toISOString(), counts: {}, memes, feedback, layouts, layout_scores: scores, runs };
snapshot.counts = {
  memes: memes.length,
  by_status: memes.reduce((a, m) => ((a[m.status] = (a[m.status] ?? 0) + 1), a), {}),
  feedback: feedback.length,
  layouts: layouts.length,
  runs: runs.length,
};
const file = path.join(dir, `smiler-${snapshot.taken_at.slice(0, 10)}.json`);
fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
console.log(`backup: ${file} (${JSON.stringify(snapshot.counts)})`);
