// The text pipeline as a library: seeds -> writer -> validation -> critic -> blind reader (gate)
// -> selection -> matcher. Used by the meme-lab CLI (src/run.js) and by the Phase 1 service
// (server/), so tuning here changes both.

import fs from "node:fs";
import path from "node:path";
import { generateJSON } from "./llm.js";
import { writerSchema, criticSchema, explainerSchema, matcherSchema } from "./schemas.js";
import { root, readJSON, blindView, passesGate } from "./prompts.js";

// Everything the pipeline draws from. The CLI loads it from data/*.json; the service from Supabase.
export function loadCatalog() {
  return {
    sectors: readJSON("data/sectors.json"),
    mechanics: readJSON("data/mechanics.json"),
    formats: readJSON("data/formats.json"),
    problemBank: fs.existsSync(path.join(root, "data/problems.json")) ? readJSON("data/problems.json") : {},
    brands: readJSON("data/brands.json"),
  };
}

// ---------- seeds ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each seed gets `provenPerSeed` proven layouts (rated before, dealt by score: layoutWeight is a
// weighted shuffle, Efraimidis-Spirakis) and the rest untried ones (never rated, plain shuffle).
// The user asked for new formats over liked ones, so most slots go to untried layouts, and the
// writer must also invent new ones. Without ratings (the CLI), every layout counts as both.
export function makeSeeds(catalog, { count = 5, rng = Date.now() % 100000, freeShare = 0.3, layoutsPerSeed = 3, provenPerSeed = 1, sector, mechanic, layoutWeight = () => 1, layoutRated = () => false } = {}) {
  const rand = mulberry32(rng);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const shuffle = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Layouts are dealt from decks so one run covers as many as possible (user: "as many formats as
  // possible"); problems come from the sector's bank so jokes stay specific to the job.
  const rated = catalog.formats.filter((f) => layoutRated(f.name));
  const untried = catalog.formats.filter((f) => !layoutRated(f.name));
  const provenDeck = (rated.length ? rated : catalog.formats)
    .map((f) => ({ f, key: Math.pow(rand(), 1 / Math.max(layoutWeight(f.name), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.f.name);
  const untriedDeck = shuffle(untried.length ? untried : catalog.formats).map((f) => f.name);
  const untriedPerSeed = layoutsPerSeed - provenPerSeed;
  return Array.from({ length: count }, (_, i) => {
    const s = sector ?? pick(catalog.sectors);
    const proven = Array.from({ length: provenPerSeed }, (_, k) => provenDeck[(i * provenPerSeed + k) % provenDeck.length]);
    const fresh = Array.from({ length: untriedPerSeed }, (_, k) => untriedDeck[(i * untriedPerSeed + k) % untriedDeck.length]).filter((n) => !proven.includes(n));
    return {
      sector: s,
      mechanic: mechanic ?? (rand() < freeShare ? "free" : pick(catalog.mechanics).name),
      proven,
      untried: fresh,
      layouts: [...proven, ...fresh],
      problems: shuffle(catalog.problemBank[s] ?? []).slice(0, 4),
    };
  });
}

// ---------- validation ----------
// Cheap structural checks before the critic: drafts that fail are marked invalid and skip review.
const TEXT_IN_IMAGE = /speech bubble|thought bubble|\b(reads|says|saying|labeled|labelled|titled|that reads)\s*[:'"‘“]|\bone line is visible\b/i;
const JUNK = new Set(["", "n/a", "na", "none", "null", "undefined", "-"]);

function makeValidator(catalog) {
  const formatByName = new Map(catalog.formats.map((f) => [f.name.toLowerCase(), f]));
  const mechanicNames = new Set(catalog.mechanics.map((m) => m.name.toLowerCase()));
  // The critic missed brands twice (a designer chair, an airliner model), so they are checked in code.
  // Case-sensitive: "UPS" is a brand, "push-ups" is not.
  const brands = new RegExp(`\\b(${catalog.brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);

  return function validate(c) {
    const problems = [];
    // A catalog layout fixes the structure: its format, and for recasts the template name.
    const layout = formatByName.get(String(c.layout ?? "").trim().toLowerCase());
    if (layout) {
      c.layout = layout.name;
      c.format = layout.format;
      if (layout.format === "recast_template") c.template = layout.name;
    } else if (!/^new:/i.test(String(c.layout ?? "").trim())) {
      problems.push(`unknown layout "${c.layout}" (use a catalog name or "New: ...")`);
    } else if (String(c.layout_description ?? "").trim().length < 15) {
      problems.push("invented layout without a layout_description");
    }
    if (layout) c.layout_description = "";
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
      const brand = brands.exec(`${p.speaker} ${p.line} ${p.scene}`);
      if (brand) problems.push(`panel ${i + 1} names a real brand (${brand[1]})`);
    });
    if (problems.length) c.invalid = problems.join("; ");
    return c;
  };
}

// ---------- pipeline ----------
const MECHANIC_CAP = 2;

// Runs one model config over all seeds. Returns { concepts, cost, seconds, errors }; every concept
// is returned (invalid, cut and kept) so callers can store or report all of them.
export async function runConfig(config, seeds, { catalog, prompts, perSeed = 8, keepCount = 2, log = () => {} }) {
  const validate = makeValidator(catalog);
  const formatByName = new Map(catalog.formats.map((f) => [f.name.toLowerCase(), f]));
  const cost = { usd: 0, tokens: 0 };
  const track = (role, usage) => {
    const [pin, pout] = config[role].price ?? [0, 0];
    cost.usd += (usage.input * pin + usage.output * pout) / 1e6;
    cost.tokens += usage.input + usage.output;
  };
  const layoutText = (name) => {
    const f = formatByName.get(name.toLowerCase());
    return `- **${f.name}** (${f.format}): ${f.layout}`;
  };
  // keptMechanics counts picks per mechanic (and marks used layouts) across the whole run.
  const keptMechanics = new Map();

  async function runSeed(seed, seedIdx) {
    const writerUser = [
      `Sector: ${seed.sector}`,
      seed.problems.length
        ? `Real problems in this job (use these, or others just as specific):\n${seed.problems.map((p) => `- ${p}`).join("\n")}`
        : "Problems: choose specific, real problems from this job.",
      `Mechanic: ${seed.mechanic}`,
      `Proven layout (the editor already likes it; use it for at most ${Math.max(1, Math.round(perSeed * 0.3))} concepts):\n${(seed.proven ?? seed.layouts.slice(0, 1)).map(layoutText).join("\n")}`,
      `Untried layouts (never shown to the editor yet; give each a real attempt):\n${(seed.untried ?? seed.layouts.slice(1)).map(layoutText).join("\n")}`,
      `Invent: at least ${Math.max(2, Math.round(perSeed * 0.3))} concepts must use a layout that is not in the catalog. Name it "New: <short name>" in "layout" and describe its structure in one sentence in "layout_description" (what each panel or the picture shows), so it can be reused for other jobs. Do not rename an existing layout. Catalog, for reference: ${catalog.formats.map((f) => f.name).join(", ")}.`,
      `Mark untried and invented concepts explore: true. Write ${perSeed} concepts.`,
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
      const ex = await generateJSON(config.explainer, { system: prompts.explainer, user: JSON.stringify(blindView(c), null, 2), schema: explainerSchema, kind: "explainer" });
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
    // Newness first (user: "shouldn't always generate liked formats"): an invented layout if one
    // passes, else an untried one; then the best remaining concept, proven or not.
    const invented = (c) => /^new:/i.test(String(c.layout));
    const untriedNames = new Set((seed.untried ?? []).map((n) => n.toLowerCase()));
    take(passing.find((c) => invented(c) && open(c)) ?? passing.find((c) => untriedNames.has(String(c.layout).toLowerCase()) && open(c)));
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

  const t0 = Date.now();
  const all = [];
  const errors = [];
  for (const [i, seed] of seeds.entries()) {
    log(`[${config.name}] seed ${i + 1}/${seeds.length} ${seed.sector} × ${seed.mechanic} ... `);
    try {
      const concepts = await runSeed(seed, i);
      all.push(...concepts);
      const kept = concepts.filter((c) => c.kept);
      log(
        `${concepts.length} written (${concepts.filter((c) => c.explore).length} experiments), ${concepts.filter((c) => c.invalid).length} invalid, ` +
          `${concepts.filter((c) => c.passed).length} passed, ${kept.length} kept (${kept.filter((c) => c.explore).length} experiments)\n`,
      );
    } catch (err) {
      log(`ERROR: ${err.message}\n`);
      errors.push({ seed: i + 1, message: err.message });
    }
  }
  return { concepts: all, ...cost, seconds: Math.round((Date.now() - t0) / 1000), errors };
}
