// Re-judges concepts the user already rated and measures agreement with the user.
// Use it to tune critic.md / explainer.md against real taste instead of guessing.
//
//   node src/calibrate.js --config gemma path/to/ratings.json [more ratings.json ...]
//
// The rated concepts are removed from the feedback block so the critic can't see the answers.

import fs from "node:fs";
import { generateJSON } from "./llm.js";
import { criticSchema, explainerSchema, matcherSchema } from "./schemas.js";
import { readJSON, buildPrompts, blindView, passesGate, ratingKey } from "./prompts.js";

const argv = process.argv.slice(2);
const ci = argv.indexOf("--config");
const configName = ci >= 0 ? argv[ci + 1] : "gemma";
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--config");
if (!files.length) {
  console.error("Usage: node src/calibrate.js --config gemma ratings.json [...]");
  process.exit(1);
}
const config = readJSON(`configs/${configName}.json`);

// Ids repeat across runs, so each rated concept gets its run-qualified key as id.
const rated = files
  .flatMap((f) => {
    const { started, ratings } = JSON.parse(fs.readFileSync(f, "utf8"));
    return ratings.map((r) => ({ ...r, id: ratingKey(started, r.id) }));
  })
  .filter((r) => r.rating);
const prompts = buildPrompts({ excludeIds: new Set(rated.map((r) => r.id)) });

// Same batch size as a real run, in a fixed shuffled order so batches mix models and seeds.
const hash = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
const order = rated.slice().sort((a, b) => hash(a.id) - hash(b.id));
const reviews = new Map();
for (let i = 0; i < order.length; i += 8) {
  const batch = order.slice(i, i + 8);
  process.stdout.write(`critic ${i + 1}-${i + batch.length}/${order.length} ... `);
  const { data } = await generateJSON(config.critic, {
    system: prompts.critic,
    user: `Review these ${batch.length} concepts:\n\n${JSON.stringify(
      batch.map((c) => ({ id: c.id, sector: c.sector, mechanic: c.mechanic, ...blindView(c) })), null, 2)}`,
    schema: criticSchema,
    kind: "critic",
  });
  for (const r of data.reviews) reviews.set(r.id, r);
  console.log("ok");
}

for (const [i, c] of order.entries()) {
  process.stdout.write(`explain ${i + 1}/${order.length} ... `);
  const ex = await generateJSON(config.explainer, { system: prompts.explainer, user: JSON.stringify(blindView(c), null, 2), schema: explainerSchema, kind: "explainer" });
  const m = await generateJSON(config.matcher, {
    system: prompts.matcher,
    user: `Intended joke: ${c.premise}\n\nReader's explanation: ${ex.data.explanation}`,
    schema: matcherSchema,
    kind: "matcher",
  });
  c.explain = ex.data;
  c.review = reviews.get(c.id);
  c.match = m.data;
  console.log(`clarity ${ex.data.clarity}, smile ${ex.data.smile ?? "-"}, ${m.data.match}`);
}

fs.mkdirSync("results", { recursive: true });
const outFile = `results/calibration-${configName}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
fs.writeFileSync(outFile, JSON.stringify(order.map((c) => ({ id: c.id, rating: c.rating, reasons: c.reasons, review: reviews.get(c.id), explain: c.explain, match: c.match })), null, 2));
console.log(`Saved ${outFile}`);

// ---------- agreement ----------
const pearson = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let c = 0, vx = 0, vy = 0;
  xs.forEach((x, i) => { c += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
  return vx && vy ? c / Math.sqrt(vx * vy) : NaN;
};
const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");
const rows = order.map((c) => ({ c, rv: reviews.get(c.id), user: c.rating })).filter((x) => x.rv);
const user = rows.map((x) => x.user);

console.log(`\nCritic (${configName}) vs you, ${rows.length} concepts`);
console.log(`  Pearson overall vs your rating: ${pearson(rows.map((x) => x.rv.overall), user).toFixed(2)}`);
for (const k of ["instant", "relatable", "twist", "tight", "visual_payoff"]) {
  console.log(`  Pearson ${k.padEnd(13)}: ${pearson(rows.map((x) => x.rv[k]), user).toFixed(2)}`);
}
const keep = rows.filter((x) => x.rv.verdict === "keep" && x.rv.overall >= 8);
const rest = rows.filter((x) => !keep.includes(x));
console.log(`  critic keeps ${keep.length}: your avg ${avg(keep.map((x) => x.user))} | the rest ${rest.length}: your avg ${avg(rest.map((x) => x.user))}`);
const good = rows.filter((x) => x.user >= 4), bad = rows.filter((x) => x.user <= 2);
console.log(`  your 4-5s the critic kept: ${good.filter((x) => keep.includes(x)).length}/${good.length} | your 1-2s it kept: ${bad.filter((x) => keep.includes(x)).length}/${bad.length}`);

const passed = passesGate;
console.log(`\nExplain test vs you`);
console.log(`  Pearson clarity vs your rating: ${pearson(order.map((c) => c.explain.clarity), order.map((c) => c.rating)).toFixed(2)}`);
if (order.every((c) => typeof c.explain.smile === "number")) {
  console.log(`  Pearson smile vs your rating:   ${pearson(order.map((c) => c.explain.smile), order.map((c) => c.rating)).toFixed(2)}`);
}
console.log(`  passes among your 4-5s: ${good.filter((x) => passed(x.c)).length}/${good.length} | among your 1-2s: ${bad.filter((x) => passed(x.c)).length}/${bad.length}`);
const unclear = order.filter((c) => c.reasons?.includes("unclear"));
if (unclear.length) console.log(`  you marked unclear: ${unclear.length}, explain test failed ${unclear.filter((c) => !passed(c)).length} of them`);
