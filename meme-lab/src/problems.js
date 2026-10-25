// Fills data/problems.json: concrete, job-specific pain points per sector, which seeds feed to the
// writer so jokes are about this job rather than generic office perks. Hand edits are kept.
//
//   node src/problems.js [--config gemma] [--per 12] [--force]

import fs from "node:fs";
import path from "node:path";
import { generateJSON } from "./llm.js";
import { root, readJSON } from "./prompts.js";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const role = { ...readJSON(`configs/${opt("config", "gemma")}.json`).writer, temperature: 0.8 };
const per = Number(opt("per", 12));
const force = argv.includes("--force");

const file = path.join(root, "data/problems.json");
const bank = fs.existsSync(file) ? readJSON("data/problems.json") : {};
const sectors = readJSON("data/sectors.json");

const schema = {
  type: "object",
  properties: { problems: { type: "array", items: { type: "string" } } },
  required: ["problems"],
  additionalProperties: false,
};
const system = `You list the real, everyday frustrations of a profession for a workplace humor series. Each item is one short, concrete sentence naming something only this job has: its tools, machines, metrics and targets, rules and paperwork, customers or patients, shifts and rituals, and the ways management mishandles them. Mix small daily annoyances with absurd management decisions. Anyone should recognize the situation even if they never did this job. No generic office perks (coffee machines, pizza parties, wellness emails, team building), no real companies or people, no politics.`;

for (const sector of sectors) {
  if (bank[sector]?.length && !force) continue;
  process.stdout.write(`${sector} ... `);
  try {
    const { data } = await generateJSON(role, { system, user: `Profession: ${sector}\nList ${per} frustrations.`, schema, kind: "problems" });
    bank[sector] = data.problems.map((p) => p.trim()).filter(Boolean);
    fs.writeFileSync(file, JSON.stringify(bank, null, 2) + "\n");
    console.log(bank[sector].length);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
console.log(`Sectors with problems: ${Object.keys(bank).length}/${sectors.length}`);
