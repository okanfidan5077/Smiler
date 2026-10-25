// Loads the meme-lab catalog into Supabase (sectors, mechanics, layouts, problems) and turns the
// user's meme-lab ratings into starting layout scores. Safe to re-run: existing rows are updated.
//
//   npm run seed -- path/to/ratings.json [more ratings.json ...]
//
// A rating of 4-5 counts as one approval for its layout, 1-2 as one rejection, 3 as half of each.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { repoRoot, need } from "../src/env.js";

const lab = path.join(repoRoot, "meme-lab");
const readLab = (p) => JSON.parse(fs.readFileSync(path.join(lab, p), "utf8"));
const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const check = ({ error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

// ---------- layout priors from meme-lab ratings ----------
const formats = readLab("data/formats.json");
const formatNames = new Set(formats.map((f) => f.name));
const runsByStart = {};
const resultsDir = path.join(lab, "results");
for (const d of fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir) : []) {
  const file = path.join(resultsDir, d, "results.json");
  if (fs.existsSync(file)) {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    runsByStart[r.started] = r;
  }
}
const priors = new Map();
let counted = 0, unmatched = 0;
for (const file of process.argv.slice(2)) {
  const { started, ratings } = JSON.parse(fs.readFileSync(file, "utf8"));
  const run = runsByStart[started];
  if (!run) {
    console.warn(`skipping ${file}: its run (${started}) is not in meme-lab/results`);
    continue;
  }
  const byId = new Map(run.concepts.map((c) => [c.id, c]));
  for (const r of ratings.filter((r) => r.rating)) {
    const c = byId.get(r.id);
    // Older rounds predate the layout field; their recasts map by template name.
    const name = c?.layout ?? (formatNames.has(c?.template) ? c.template : null);
    if (!name || !formatNames.has(name)) {
      unmatched++;
      continue;
    }
    const p = priors.get(name) ?? { up: 0, down: 0 };
    if (r.rating >= 4) p.up += 1;
    else if (r.rating <= 2) p.down += 1;
    else { p.up += 0.5; p.down += 0.5; }
    priors.set(name, p);
    counted++;
  }
}
if (process.argv.length > 2) console.log(`layout priors: ${counted} ratings on ${priors.size} layouts (${unmatched} without a catalog layout)`);

// ---------- catalog ----------
check(await db.from("sectors").upsert(readLab("data/sectors.json").map((name) => ({ name })), { onConflict: "name" }), "sectors");
check(await db.from("mechanics").upsert(readLab("data/mechanics.json").map((m) => ({ name: m.name, shape: m.shape, example: m.example ?? "" })), { onConflict: "name" }), "mechanics");
check(
  await db.from("layouts").upsert(
    formats.map((f) => ({ name: f.name, format: f.format, layout: f.layout, prior_up: priors.get(f.name)?.up ?? 0, prior_down: priors.get(f.name)?.down ?? 0 })),
    { onConflict: "name" },
  ),
  "layouts",
);

const { data: sectorRows, error } = await db.from("sectors").select("id, name");
if (error) throw error;
const sectorId = new Map(sectorRows.map((s) => [s.name, s.id]));
const problems = Object.entries(readLab("data/problems.json")).flatMap(([sector, list]) =>
  sectorId.has(sector) ? list.map((description) => ({ sector_id: sectorId.get(sector), description })) : [],
);
check(await db.from("problems").upsert(problems, { onConflict: "sector_id,description", ignoreDuplicates: true }), "problems");

console.log(`seeded ${sectorRows.length} sectors, ${readLab("data/mechanics.json").length} mechanics, ${formats.length} layouts, ${problems.length} problems`);
