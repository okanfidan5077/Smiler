// Adds hand-written or externally written concepts to an existing run, judged by the same critic and
// blind reader as the run's own picks, so they can be rated blind in one report.
//
//   node src/add-concepts.js results/<timestamp> concepts.json --as claude [--judge gemma]
//
// Each concept: { seed: <1-based seed index>, layout, format, template?, mechanic, explore, sector, premise, panels[] }.

import fs from "node:fs";
import path from "node:path";
import { generateJSON } from "./llm.js";
import { criticSchema, explainerSchema, matcherSchema } from "./schemas.js";
import { readJSON, buildPrompts, blindView, GATE } from "./prompts.js";
import { renderReport } from "./report.js";

const [dir, file, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : fallback);
if (!dir || !file) {
  console.error("Usage: node src/add-concepts.js results/<timestamp> concepts.json --as claude [--judge gemma]");
  process.exit(1);
}
const as = opt("as", "external");
const judge = readJSON(`configs/${opt("judge", "gemma")}.json`);
const prompts = buildPrompts();

const resultsPath = path.join(dir, "results.json");
const result = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const counters = {};
const added = JSON.parse(fs.readFileSync(file, "utf8")).map((c) => {
  counters[c.seed] = (counters[c.seed] ?? 0) + 1;
  return { ...c, template: c.template ?? "", id: `${as}-${c.seed}-${counters[c.seed]}`, config: as, seed: result.seeds[c.seed - 1], kept: true };
});

const { data } = await generateJSON(judge.critic, {
  system: prompts.critic,
  user: `Review these ${added.length} concepts:\n\n${JSON.stringify(added.map((c) => ({ id: c.id, sector: c.sector, mechanic: c.mechanic, ...blindView(c) })), null, 2)}`,
  schema: criticSchema,
  kind: "critic",
});
const reviews = new Map(data.reviews.map((r) => [r.id, r]));

for (const c of added) {
  c.review = reviews.get(c.id) ?? null;
  const ex = await generateJSON(judge.explainer, { system: prompts.explainer, user: JSON.stringify(blindView(c), null, 2), schema: explainerSchema, kind: "explainer" });
  c.explain = ex.data;
  c.passed = c.explain.clarity >= GATE.clarity && c.explain.smile >= GATE.smile;
  const m = await generateJSON(judge.matcher, {
    system: prompts.matcher,
    user: `Intended joke: ${c.premise}\n\nReader's explanation: ${c.explain.explanation}`,
    schema: matcherSchema,
    kind: "matcher",
  });
  c.match = m.data;
  console.log(`${c.id} ${c.layout}: critic ${c.review?.overall ?? "-"}, clarity ${c.explain.clarity}, smile ${c.explain.smile}, ${c.passed ? "passes" : "fails"} gate`);
}

result.concepts = result.concepts.filter((c) => c.config !== as).concat(added);
fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(dir, "report.html"), renderReport(result));
console.log(`Added ${added.length} ${as} concepts to ${dir}`);
