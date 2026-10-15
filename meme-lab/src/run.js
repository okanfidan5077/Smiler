// Phase 0 runner: seeds -> writer -> critic -> blind explainer -> matcher -> report.
//
//   node src/run.js --configs local,cloud --seeds 5 --n 8 --keep 2
//
// Every config gets the same seeds, so the report compares like with like.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateJSON } from "./llm.js";
import { writerSchema, criticSchema, explainerSchema, matcherSchema } from "./schemas.js";
import { renderReport } from "./report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const readJSON = (p) => JSON.parse(read(p));

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
const examples = readJSON("data/examples.json");
const feedback = readJSON("data/feedback.json");

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

const mechanicsText = mechanics.map((m) => `- **${m.name}**: ${m.shape} Example: ${m.example}`).join("\n");
const panelsText = (panels) => panels.map((p) => `${p.speaker}: "${p.line}"`).join(" / ");
const examplesText = examples
  .map((e) => `- (${e.format}${e.template ? `, ${e.template}` : ""}; ${e.mechanic}) ${panelsText(e.panels)}`)
  .join("\n");

function feedbackText() {
  const liked = feedback.liked.slice(-15);
  const rejected = feedback.rejected.slice(-15);
  if (!liked.length && !rejected.length) return "No feedback yet.";
  const fmt = (f) =>
    `- ${panelsText(f.panels)}${f.reasons?.length ? ` [${f.reasons.join(", ")}]` : ""}${f.note ? ` Note: ${f.note}` : ""}`;
  return [
    liked.length ? `Liked:\n${liked.map(fmt).join("\n")}` : "",
    rejected.length ? `Rejected:\n${rejected.map(fmt).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

const sharedVars = { mechanics: mechanicsText, examples: examplesText, feedback: feedbackText() };
const prompts = {
  writer: fill(read("prompts/writer.md"), sharedVars),
  critic: fill(read("prompts/critic.md"), sharedVars),
  explainer: read("prompts/explainer.md"),
  matcher: read("prompts/matcher.md"),
};

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
const seeds = Array.from({ length: seedCount }, () => ({
  sector: args.sector ?? pick(sectors),
  mechanic: args.mechanic ?? (rand() < freeShare ? "free" : pick(mechanics).name),
}));

// ---------- pipeline ----------
const blindView = (c) => ({
  format: c.format,
  template: c.template,
  panels: c.panels.map((p, i) => ({ panel: i + 1, image: p.scene, speaker: p.speaker, line: p.line })),
});

async function runSeed(config, seed, seedIdx, cost) {
  const track = (role, usage) => {
    const [pin, pout] = config[role].price ?? [0, 0];
    cost.usd += (usage.input * pin + usage.output * pout) / 1e6;
    cost.tokens += usage.input + usage.output;
  };

  const writerUser = [
    `Sector: ${seed.sector}`,
    `Problem: ${seed.problem ?? "choose realistic problems from this sector"}`,
    `Mechanic: ${seed.mechanic}`,
    `Write ${perSeed} concepts.`,
  ].join("\n");
  const w = await generateJSON(config.writer, { system: prompts.writer, user: writerUser, schema: writerSchema, kind: "writer" });
  track("writer", w.usage);
  const concepts = w.data.concepts.map((c, i) => ({ id: `${config.name}-${seedIdx + 1}-${i + 1}`, config: config.name, seed, ...c }));

  // The critic judges as a reader would: no premise, no self-assessment.
  const criticUser = `Review these ${concepts.length} concepts:\n\n${JSON.stringify(
    concepts.map((c) => ({ id: c.id, sector: c.sector, mechanic: c.mechanic, ...blindView(c) })),
    null, 2,
  )}`;
  const cr = await generateJSON(config.critic, { system: prompts.critic, user: criticUser, schema: criticSchema, kind: "critic" });
  track("critic", cr.usage);
  const reviews = new Map(cr.data.reviews.map((r) => [r.id, r]));
  for (const c of concepts) c.review = reviews.get(c.id) ?? null;

  const ranked = concepts
    .filter((c) => c.review && c.review.verdict !== "cut")
    .sort((a, b) => b.review.overall - a.review.overall)
    .slice(0, keepCount);

  for (const c of ranked) {
    c.kept = true;
    const ex = await generateJSON(config.explainer, {
      system: prompts.explainer,
      user: JSON.stringify(blindView(c), null, 2),
      schema: explainerSchema,
      kind: "explainer",
    });
    track("explainer", ex.usage);
    c.explain = ex.data;

    const m = await generateJSON(config.matcher, {
      system: prompts.matcher,
      user: `Intended joke: ${c.premise}\n\nReader's explanation: ${c.explain.explanation}`,
      schema: matcherSchema,
      kind: "matcher",
    });
    track("matcher", m.usage);
    c.match = m.data;
    c.passed = c.match.match !== "no" && c.explain.clarity >= 3;
  }
  return concepts;
}

const started = new Date();
const outDir = path.join(root, "results", started.toISOString().replace(/[:.]/g, "-").slice(0, 19));
fs.mkdirSync(outDir, { recursive: true });

console.log(`Seeds (rng ${rngSeed}):`);
seeds.forEach((s, i) => console.log(`  ${i + 1}. ${s.sector} × ${s.mechanic}`));

const all = [];
const runs = [];
for (const config of configs) {
  const cost = { usd: 0, tokens: 0 };
  const t0 = Date.now();
  const errors = [];
  for (const [i, seed] of seeds.entries()) {
    process.stdout.write(`[${config.name}] seed ${i + 1}/${seeds.length} ${seed.sector} × ${seed.mechanic} ... `);
    try {
      const concepts = await runSeed(config, seed, i, cost);
      all.push(...concepts);
      const kept = concepts.filter((c) => c.kept);
      console.log(`${concepts.length} written, ${kept.length} kept, ${kept.filter((c) => c.passed).length} passed`);
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
    `  ${r.config}: ${mine.length} written, ${mine.filter((c) => c.kept).length} kept, ${mine.filter((c) => c.passed).length} passed, ` +
      `${r.tokens} tokens, ~$${r.usd.toFixed(3)}, ${r.seconds}s${r.errors.length ? `, ${r.errors.length} errors` : ""}`,
  );
}
console.log(`\nReport: ${path.join(outDir, "report.html")}`);
