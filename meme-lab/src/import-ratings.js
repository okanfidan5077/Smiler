// Folds exported ratings into data/feedback.json, which the writer and critic read.
//
//   node src/import-ratings.js path/to/ratings.json
//
// Rating 4-5 -> liked, 1-2 -> rejected, 3 -> skipped (no clear signal).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file) {
  console.error("Usage: node src/import-ratings.js path/to/ratings.json");
  process.exit(1);
}

const feedbackPath = path.join(root, "data/feedback.json");
const feedback = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
const { ratings } = JSON.parse(fs.readFileSync(file, "utf8"));
const known = new Set([...feedback.liked, ...feedback.rejected].map((f) => f.id));

let liked = 0, rejected = 0;
for (const r of ratings) {
  if (!r.rating || known.has(r.id)) continue;
  const entry = { id: r.id, rating: r.rating, format: r.format, template: r.template, panels: r.panels.map(({ speaker, line }) => ({ speaker, line })), reasons: r.reasons ?? [], note: r.note ?? "" };
  if (r.rating >= 4) { feedback.liked.push(entry); liked++; }
  else if (r.rating <= 2) { feedback.rejected.push(entry); rejected++; }
}

fs.writeFileSync(feedbackPath, JSON.stringify(feedback, null, 2) + "\n");
console.log(`Added ${liked} liked and ${rejected} rejected. Totals: ${feedback.liked.length} liked, ${feedback.rejected.length} rejected.`);
