// Builds the role prompts from prompts/*.md and data/*.json. Shared by run.js and calibrate.js.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
export const readJSON = (p) => JSON.parse(read(p));

// Concept ids ("gemma-1-2") repeat across runs; a rating is identified by its run plus its id.
export const ratingKey = (started, id) => `${started}/${id}`;

const fill =(tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
const panelsText = (panels) => panels.map((p) => `${p.speaker}: "${p.line}"`).join(" / ");

// The picture carries many punchlines, so feedback shows the final scene too.
const withScene = (panels) => {
  const last = panels.at(-1);
  return `${panelsText(panels)}${last?.scene ? ` [picture: ${last.scene}]` : ""}`;
};

function feedbackText(feedback, excludeIds) {
  const keep = (f) => !excludeIds.has(f.id);
  const liked = feedback.liked.filter(keep).slice(-15);
  const rejected = feedback.rejected.filter(keep).slice(-15);
  if (!liked.length && !rejected.length) return "No feedback yet.";
  const fmt = (f) =>
    `- ${withScene(f.panels)}${f.reasons?.length ? ` [${f.reasons.join(", ")}]` : ""}${f.note ? ` Note: ${f.note}` : ""}`;
  return [
    liked.length ? `Liked:\n${liked.map(fmt).join("\n")}` : "",
    rejected.length ? `Rejected:\n${rejected.map(fmt).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// excludeIds keeps rated concepts out of the feedback when the critic is calibrated on them.
// The service passes mechanics and feedback from Supabase; the CLI reads them from data/.
export function buildPrompts({ excludeIds = new Set(), mechanics, feedback } = {}) {
  mechanics ??= readJSON("data/mechanics.json");
  feedback ??= readJSON("data/feedback.json");
  const examples = readJSON("data/examples.json");
  const vars = {
    mechanics: mechanics.map((m) => `- **${m.name}**: ${m.shape} Example: ${m.example}`).join("\n"),
    examples: examples
      .map((e) => `- (${e.format}${e.template ? `, ${e.template}` : ""}; ${e.mechanic}) ${panelsText(e.panels)}`)
      .join("\n"),
    feedback: feedbackText(feedback, excludeIds),
  };
  return {
    writer: fill(read("prompts/writer.md"), vars),
    critic: fill(read("prompts/critic.md"), vars),
    explainer: read("prompts/explainer.md"),
    matcher: read("prompts/matcher.md"),
  };
}

// The blind reader is the quality gate. Round 1 calibration: all of the user's 4-5s had
// clarity 5; all of their 1-2s had 4 or less. Re-calibrated on 90 ratings (rounds 1-6): the
// gate passes 65/70 of the user's 4-5s and 3/10 of the 1-2s; adding the critic's instant >= 4
// drops one more bad one for 7 good ones. Smile has saturated at 3, so it no longer ranks.
export const GATE = { clarity: 5, smile: 3, instant: 4 };
export const passesGate = (c) =>
  c.explain.clarity >= GATE.clarity && c.explain.smile >= GATE.smile && (c.review?.instant ?? 0) >= GATE.instant;

// What a reader would see: no premise, no mechanic, no self-assessment.
export const blindView = (c) => ({
  format: c.format,
  template: c.template,
  panels: c.panels.map((p, i) => ({ panel: i + 1, image: p.scene, speaker: p.speaker, line: p.line })),
});
