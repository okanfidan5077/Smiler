// Adds a reader translation to a run's results and re-renders its report.
// The English text stays the source of truth; translations are only a reading aid.
//
//   node src/translate.js results/<timestamp> [--lang Turkish] [--config gemma]
//
// translateConcept() is also used by the Phase 1 service for the admin page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateJSON } from "./llm.js";
import { renderReport } from "./report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({ premise: str, panels: { type: "array", items: obj({ line: str, scene: str }) } });

const systemFor = (lang) =>
  `Translate meme drafts from English into natural, everyday ${lang}, the way a native speaker would say it at work. Keep the joke working: keep the punchline last, keep it short, keep deadpan tone. Translate meaning, not word by word; adapt idioms. Do not explain or add anything. Return one entry per panel, in order. Translate every field, including "scene" (the picture description) and "premise"; never leave English text. Keep an empty line empty.`;

// Returns { premise, panels: [{ line, scene }] } in the target language. role is a model config
// (the writer's, at low temperature).
export async function translateConcept(role, c, lang = "Turkish") {
  const { data } = await generateJSON({ ...role, temperature: 0.2 }, {
    system: systemFor(lang),
    user: JSON.stringify({ premise: c.premise, panels: c.panels.map(({ line, scene }) => ({ line, scene })) }, null, 2),
    schema,
    kind: "translate",
  });
  return data;
}

async function main() {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) {
    console.error("Usage: node src/translate.js results/<timestamp> [--lang Turkish] [--config gemma]");
    process.exit(1);
  }
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  const lang = opt("lang", "Turkish");
  const config = JSON.parse(fs.readFileSync(path.join(root, "configs", `${opt("config", "gemma")}.json`), "utf8"));

  const resultsPath = path.join(dir, "results.json");
  const result = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  // Redo concepts with no translation, or where the model copied a scene back in English.
  const todo = result.concepts.filter((c) => !c.premise_tr || c.panels.some((p) => p.scene && p.tr?.scene === p.scene));

  for (const [i, c] of todo.entries()) {
    process.stdout.write(`${i + 1}/${todo.length} ${c.id} ... `);
    try {
      const data = await translateConcept(config.writer, c, lang);
      c.premise_tr = data.premise;
      c.panels.forEach((p, j) => (p.tr = data.panels[j] ?? null));
      console.log("ok");
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "report.html"), renderReport(result));
  console.log(`Report: ${path.join(dir, "report.html")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
