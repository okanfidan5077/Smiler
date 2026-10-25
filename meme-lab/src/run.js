// Phase 0 runner: seeds -> writer -> critic -> blind explainer -> matcher -> report.
//
//   node src/run.js --configs local,cloud --seeds 5 --n 8 --keep 2
//
// Every config gets the same seeds, so the report compares like with like. The pipeline itself
// lives in src/pipeline.js, shared with the Phase 1 service.

import fs from "node:fs";
import path from "node:path";
import { renderReport } from "./report.js";
import { root, readJSON, buildPrompts } from "./prompts.js";
import { loadCatalog, makeSeeds, runConfig } from "./pipeline.js";

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]);
    return acc;
  }, []),
);
const configNames = (args.configs ?? "mock").split(",");
if (new Set(configNames).size !== configNames.length) throw new Error("Each config may appear only once in --configs");
const perSeed = Number(args.n ?? 8);
const keepCount = Number(args.keep ?? 2);
const rngSeed = Number(args.rng ?? Date.now() % 100000);

const configs = configNames.map((n) => ({ name: n, ...readJSON(`configs/${n}.json`) }));
const catalog = loadCatalog();
const prompts = buildPrompts();
const seeds = makeSeeds(catalog, {
  count: Number(args.seeds ?? 5),
  rng: rngSeed,
  freeShare: Number(args.free ?? 0.3),
  layoutsPerSeed: Number(args.layouts ?? 3),
  sector: args.sector,
  mechanic: args.mechanic,
});

const started = new Date();
const outDir = path.join(root, "results", started.toISOString().replace(/[:.]/g, "-").slice(0, 19));
fs.mkdirSync(outDir, { recursive: true });

console.log(`Seeds (rng ${rngSeed}):`);
seeds.forEach((s, i) => console.log(`  ${i + 1}. ${s.sector} × ${s.mechanic} [${s.layouts.join(", ")}]${s.problems.length ? "" : " (no problem bank)"}`));

const all = [];
const runs = [];
for (const config of configs) {
  const run = await runConfig(config, seeds, { catalog, prompts, perSeed, keepCount, log: (s) => process.stdout.write(s) });
  all.push(...run.concepts);
  runs.push({ config: config.name, seconds: run.seconds, usd: run.usd, tokens: run.tokens, errors: run.errors });
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
