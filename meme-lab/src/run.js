// Phase 0 runner: seeds -> writer -> critic -> blind explainer -> matcher -> report.
//
//   node src/run.js --configs local,cloud --seeds 5 --n 8 --keep 2
//
// Every config gets the same seeds, so the report compares like with like.

import fs from "node:fs";
import path from "node:path";
import { generateJSON } from "./llm.js";
import { writerSchema, criticSchema, explainerSchema, matcherSchema } from "./schemas.js";
import { renderReport } from "./report.js";
import { root, readJSON, buildPrompts, blindView, passesGate } from "./prompts.js";

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]);
    return acc;
  }, []),
);
const configNames = (args.configs ?? "mock").split(",");
if (new Set(configNames).size !== configNames.length) throw new Error("Each config may appear only once in --configs");
const seedCount = Number(args.seeds ?? 5);
const perSeed = Number(args.n ?? 8);
const keepCount = Number(args.keep ?? 2);
const rngSeed = Number(args.rng ?? Date.now() % 100000);
const freeShare = Number(args.free ?? 0.3);

// ---------- data ----------
const configs = configNames.map((n) => ({ name: n, ...readJSON(`configs/${n}.json`) }));
const sectors = readJSON("data/sectors.json");
const mechanics = readJSON("data/mechanics.json");
const formats = readJSON("data/formats.json");
const formatByName = new Map(formats.map((f) => [f.name.toLowerCase(), f]));
const problemBank = fs.existsSync(path.join(root, "data/problems.json")) ? readJSON("data/problems.json") : {};
const prompts = buildPrompts();

// ---------- seeds ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(rngSeed);
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// Layouts are dealt from a shuffled catalog so one run covers as many as possible (user: "as many
// formats as possible"); problems come from the sector's bank so jokes stay specific to the job.
const deck = shuffle(formats);
const layoutsPerSeed = Number(args.layouts ?? 3);
const seeds = Array.from({ length: seedCount }, (_, i) => {
  const sector = args.sector ?? pick(sectors);
  return {
    sector,
    mechanic: args.mechanic ?? (rand() < freeShare ? "free" : pick(mechanics).name),
    layouts: Array.from({ length: layoutsPerSeed }, (_, k) => deck[(i * layoutsPerSeed + k) % deck.length].name),
    problems: shuffle(problemBank[sector] ?? []).slice(0, 4),
  };
});

// ---------- validation ----------
// Cheap structural checks before the critic: drafts that fail are marked invalid and skip review.
// The critic missed brands twice (a designer chair, an airliner model), so they are checked in code.
const BRANDS = new RegExp(`\\b(${readJSON("data/brands.json").map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`); // case-sensitive: "UPS" is a brand, "push-ups" is not
const TEXT_IN_IMAGE =/speech bubble|thought bubble|\b(reads|says|saying|labeled|labelled|titled|that reads)\s*[:'"‘“]|\bone line is visible\b/i;
const JUNK = new Set(["", "n/a", "na", "none", "null", "undefined", "-"]);
const mechanicNames = new Set(mechanics.map((m) => m.name.toLowerCase()));

function validate(c) {
  const problems = [];
  // A catalog layout fixes the structure: its format, and for recasts the template name.
  const layout = formatByName.get(String(c.layout ?? "").trim().toLowerCase());
  if (layout) {
    c.layout = layout.name;
    c.format = layout.format;
    if (layout.format === "recast_template") c.template = layout.name;
  } else if (!/^new:/i.test(String(c.layout ?? "").trim())) {
    problems.push(`unknown layout "${c.layout}" (use a catalog name or "New: ...")`);
  }
  const template = String(c.template ?? "").trim();
  if (c.format === "recast_template") {
    if (JUNK.has(template.toLowerCase()) || mechanicNames.has(template.toLowerCase())) problems.push("recast_template without a real template name");
  } else {
    c.template = ""; // writers put "N/A", "null" or the mechanic here
  }
  const panels = c.panels ?? [];
  const [min, max] = { single: [1, 1], multi_panel: [2, 4], recast_template: [1, 5] }[c.format] ?? [1, 5];
  if (panels.length < min || panels.length > max) problems.push(`${c.format} needs ${min}-${max} panels, got ${panels.length}`);
  panels.forEach((p, i) => {
    for (const field of ["speaker", "line", "scene"]) {
      if (JUNK.has(String(p[field] ?? "").trim().toLowerCase())) problems.push(`panel ${i + 1} has an empty ${field}`);
    }
    // Images never carry text; image models garble it (user: speech bubbles are hard to generate).
    if (TEXT_IN_IMAGE.test(String(p.scene ?? ""))) problems.push(`panel ${i + 1} scene needs readable text in the image`);
    const brand = BRANDS.exec(`${p.speaker} ${p.line} ${p.scene}`);
    if (brand) problems.push(`panel ${i + 1} names a real brand (${brand[1]})`);
  });
  if (problems.length) c.invalid = problems.join("; ");
  return c;
}

// ---------- pipeline ----------
const MECHANIC_CAP = 2;

// keptMechanics counts picks per mechanic across this config's whole run.
async function runSeed(config, seed, seedIdx, cost, keptMechanics) {
  const track = (role, usage) => {
    const [pin, pout] = config[role].price ?? [0, 0];
    cost.usd += (usage.input * pin + usage.output * pout) / 1e6;
    cost.tokens += usage.input + usage.output;
  };

  const layoutText = (name) => {
    const f = formatByName.get(name.toLowerCase());
    return `- **${f.name}** (${f.format}): ${f.layout}`;
  };
  const writerUser = [
    `Sector: ${seed.sector}`,
    seed.problems.length
      ? `Real problems in this job (use these, or others just as specific):\n${seed.problems.map((p) => `- ${p}`).join("\n")}`
      : "Problems: choose specific, real problems from this job.",
    `Mechanic: ${seed.mechanic}`,
    `Assigned layouts (spread the proven half across these):\n${seed.layouts.map(layoutText).join("\n")}`,
    `Experiments may use any other catalog layout, or invent one named "New: <name>". Catalog: ${formats.map((f) => f.name).join(", ")}.`,
    `Write ${perSeed} concepts.`,
  ].join("\n\n");
  const w = await generateJSON(config.writer, { system: prompts.writer, user: writerUser, schema: writerSchema, kind: "writer" });
  track("writer", w.usage);
  const concepts = w.data.concepts.map((c, i) => validate({ id: `${config.name}-${seedIdx + 1}-${i + 1}`, config: config.name, seed, ...c }));
  const valid = concepts.filter((c) => !c.invalid);
  if (!valid.length) return concepts;

  // The critic judges as a reader would: no premise, no self-assessment.
  const criticUser = `Review these ${valid.length} concepts:\n\n${JSON.stringify(
    valid.map((c) => ({ id: c.id, sector: c.sector, mechanic: c.mechanic, ...blindView(c) })),
    null, 2,
  )}`;
  const cr = await generateJSON(config.critic, { system: prompts.critic, user: criticUser, schema: criticSchema, kind: "critic" });
  track("critic", cr.usage);
  const reviews = new Map(cr.data.reviews.map((r) => [r.id, r]));
  for (const c of concepts) c.review = reviews.get(c.id) ?? null;

  // Calibration on the user's ratings (src/calibrate.js): the blind reader's clarity tracks the user
  // far better than the critic's overall score, so every reviewed concept gets the blind read and
  // the reader is the gate. The critic only vetoes mean jokes and breaks ties.
  for (const c of concepts.filter((c) => c.review && c.review.not_mean >= 4)) {
    const ex = await generateJSON(config.explainer, {
      system: prompts.explainer,
      user: JSON.stringify(blindView(c), null, 2),
      schema: explainerSchema,
      kind: "explainer",
    });
    track("explainer", ex.usage);
    c.explain = ex.data;
    c.passed = passesGate(c);
  }

  // Selection: the best proven concept and the best experiment first, then the rest by score.
  // A mechanic may fill at most MECHANIC_CAP picks per run and a layout one, so one working shape
  // can't take over the feed (round 3: 7 of 12 picks were the same "cosmetic fix" joke).
  const score = (c) => [c.review.instant + c.review.tight + c.review.visual_payoff, c.review.overall, c.explain.smile];
  const byScore = (a, b) => {
    const [x, y] = [score(a), score(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  };
  const mech = (c) => String(c.mechanic).trim().toLowerCase();
  const lay = (c) => `layout:${String(c.layout).trim().toLowerCase()}`;
  const open = (c) => (keptMechanics.get(mech(c)) ?? 0) < MECHANIC_CAP && !keptMechanics.has(lay(c));
  const passing = concepts.filter((c) => c.passed).sort(byScore);
  const ranked = [];
  const take = (c) => {
    if (!c || ranked.includes(c) || ranked.length >= keepCount || !open(c)) return;
    ranked.push(c);
    keptMechanics.set(mech(c), (keptMechanics.get(mech(c)) ?? 0) + 1);
    keptMechanics.set(lay(c), 1); // each layout at most once per run
  };
  take(passing.find((c) => !c.explore && open(c)));
  take(passing.find((c) => c.explore && open(c)));
  for (const c of passing) take(c);

  // The matcher is informational: it once said "no" on a meme the user rated 5.
  for (const c of ranked) {
    c.kept = true;
    const m = await generateJSON(config.matcher, {
      system: prompts.matcher,
      user: `Intended joke: ${c.premise}\n\nReader's explanation: ${c.explain.explanation}`,
      schema: matcherSchema,
      kind: "matcher",
    });
    track("matcher", m.usage);
    c.match = m.data;
  }
  return concepts;
}

const started = new Date();
const outDir = path.join(root, "results", started.toISOString().replace(/[:.]/g, "-").slice(0, 19));
fs.mkdirSync(outDir, { recursive: true });

console.log(`Seeds (rng ${rngSeed}):`);
seeds.forEach((s, i) => console.log(`  ${i + 1}. ${s.sector} × ${s.mechanic} [${s.layouts.join(", ")}]${s.problems.length ? "" : " (no problem bank)"}`));

const all = [];
const runs = [];
for (const config of configs) {
  const cost = { usd: 0, tokens: 0 };
  const t0 = Date.now();
  const errors = [];
  const keptMechanics = new Map();
  for (const [i, seed] of seeds.entries()) {
    process.stdout.write(`[${config.name}] seed ${i + 1}/${seeds.length} ${seed.sector} × ${seed.mechanic} ... `);
    try {
      const concepts = await runSeed(config, seed, i, cost, keptMechanics);
      all.push(...concepts);
      const kept = concepts.filter((c) => c.kept);
      console.log(
        `${concepts.length} written (${concepts.filter((c) => c.explore).length} experiments), ${concepts.filter((c) => c.invalid).length} invalid, ` +
          `${concepts.filter((c) => c.passed).length} passed, ${kept.length} kept (${kept.filter((c) => c.explore).length} experiments)`,
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      errors.push({ seed: i + 1, message: err.message });
    }
  }
  runs.push({ config: config.name, seconds: Math.round((Date.now() - t0) / 1000), ...cost, errors });
}

const result = { started: started.toISOString(), rngSeed, perSeed, keepCount, seeds, runs, concepts: all };
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(outDir, "report.html"), renderReport(result));

console.log("\nSummary:");
for (const r of runs) {
  const mine = all.filter((c) => c.config === r.config);
  console.log(
    `  ${r.config}: ${mine.length} written, ${mine.filter((c) => c.invalid).length} invalid, ${mine.filter((c) => c.kept).length} kept, ${mine.filter((c) => c.passed).length} passed, ` +
      `${r.tokens} tokens, ~$${r.usd.toFixed(3)}, ${r.seconds}s${r.errors.length ? `, ${r.errors.length} errors` : ""}`,
  );
}
console.log(`\nReport: ${path.join(outDir, "report.html")}`);
