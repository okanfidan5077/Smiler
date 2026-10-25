// One text run: seeds from the Supabase catalog (layouts weighted by approval score) -> the
// meme-lab pipeline -> Turkish reading aid for the picks -> every concept stored in Supabase.
// Picks become 'draft' memes in the admin queue; the rest are stored as 'candidate'.

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { buildPrompts } from "../../meme-lab/src/prompts.js";
import { makeSeeds, runConfig } from "../../meme-lab/src/pipeline.js";
import { translateConcept } from "../../meme-lab/src/translate.js";
import { db, must, loadCatalog, loadPromptFeedback } from "./db.js";
import { repoRoot, settings } from "./env.js";

export function loadConfig(name = settings.config) {
  const file = path.join(repoRoot, "meme-lab/configs", `${name}.json`);
  return { name, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

// VRAM sequencing: free the GPU for image generation once text work is done.
async function unloadModels(config) {
  const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const models = new Set(Object.values(config).filter((r) => r?.provider === "ollama").map((r) => r.model));
  for (const model of models) {
    await fetch(`${base}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
  }
}

export async function runText({ seeds = 6, n = 10, keep = 2, rng = Date.now() % 100000, log = () => {} } = {}) {
  const config = loadConfig();
  const [run] = must(
    await db.from("generation_runs").insert({ kind: "text", config, params: { seeds, n, keep, rng } }).select("id"),
    "create run",
  );
  try {
    const { catalog, layoutStats } = await loadCatalog();
    const prompts = buildPrompts({ mechanics: catalog.mechanics, feedback: await loadPromptFeedback() });
    // Per seed: one proven layout (by approval score) and two untried ones; the writer also invents.
    const seedList = makeSeeds(catalog, {
      count: seeds,
      rng,
      layoutWeight: (name) => layoutStats.get(name)?.score ?? 0.5,
      layoutRated: (name) => layoutStats.get(name)?.rated ?? false,
    });
    must(await db.from("generation_runs").update({ seeds: seedList }).eq("id", run.id), "store seeds");

    const result = await runConfig(config, seedList, { catalog, prompts, perSeed: n, keepCount: keep, log });
    const kept = result.concepts.filter((c) => c.kept);
    for (const c of kept) {
      try {
        const tr = await translateConcept(config.writer, c, settings.translateTo);
        c.premise_tr = tr.premise;
        c.panels.forEach((p, i) => (p.tr = tr.panels[i] ?? null));
      } catch (err) {
        log(`translation failed for ${c.id}: ${err.message}\n`);
      }
    }

    const memes = [];
    const panels = [];
    for (const c of result.concepts) {
      const id = crypto.randomUUID();
      memes.push({
        id,
        run_id: run.id,
        status: c.kept ? "draft" : "candidate",
        format: c.format ?? "single",
        layout: c.layout ?? "",
        layout_description: c.layout_description ?? "",
        template: c.template ?? "",
        sector: c.sector ?? c.seed.sector,
        problem: c.problem ?? "",
        mechanic: c.mechanic ?? c.seed.mechanic,
        mode: c.seed.mechanic === "free" ? "free" : "seeded",
        explore: !!c.explore,
        premise: c.premise ?? "",
        premise_tr: c.premise_tr ?? null,
        invalid: c.invalid ?? null,
        critic: c.review ?? null,
        explain: c.explain ?? null,
        match: c.match ?? null,
        gate_passed: c.passed ?? null,
      });
      (c.panels ?? []).slice(0, 5).forEach((p, i) =>
        panels.push({
          meme_id: id,
          position: i + 1,
          speaker: p.speaker ?? "",
          line: p.line ?? "",
          scene: p.scene ?? "",
          line_tr: p.tr?.line ?? null,
          scene_tr: p.tr?.scene ?? null,
        }),
      );
    }
    must(await db.from("memes").insert(memes), "store memes");
    if (panels.length) must(await db.from("panels").insert(panels), "store panels");

    const stats = {
      written: result.concepts.length,
      invalid: result.concepts.filter((c) => c.invalid).length,
      passed: result.concepts.filter((c) => c.passed).length,
      drafts: kept.length,
      experiments: kept.filter((c) => c.explore).length,
      seconds: result.seconds,
    };
    must(
      await db.from("generation_runs")
        .update({ status: "done", stats, cost_usd: result.usd, tokens: result.tokens, errors: result.errors, finished_at: new Date().toISOString() })
        .eq("id", run.id),
      "finish run",
    );
    return { run_id: run.id, ...stats, errors: result.errors };
  } catch (err) {
    await db.from("generation_runs").update({ status: "failed", errors: [{ message: err.message }], finished_at: new Date().toISOString() }).eq("id", run.id);
    throw err;
  } finally {
    await unloadModels(config);
  }
}
