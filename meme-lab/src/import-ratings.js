// Folds exported ratings into data/feedback.json, which the writer and critic read.
//
//   node src/import-ratings.js path/to/ratings.json
//
// Rating 4-5 -> liked, 1-2 -> rejected, 3 -> skipped (no clear signal).

import fs from "node:fs";
import path from "node:path";
import { root, ratingKey } from "./prompts.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node src/import-ratings.js path/to/ratings.json");
  process.exit(1);
}

const feedbackPath = path.join(root, "data/feedback.json");
const feedback = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
const { started, ratings } = JSON.parse(fs.readFileSync(file, "utf8"));
let liked = 0, rejected = 0;
for (const r of ratings) {
  if (!r.rating) continue;
  // Concept ids repeat across runs ("gemma-1-2"), so the run's start time makes the key unique.
  // Re-importing replaces an earlier entry, so changed ratings and added fields win.
  const id = ratingKey(started, r.id);
  feedback.liked = feedback.liked.filter((f) => f.id !== id);
  feedback.rejected = feedback.rejected.filter((f) => f.id !== id);
  const entry = { id, rating: r.rating, format: r.format, template: r.template, panels: r.panels.map(({ speaker, line, scene }) => ({ speaker, line, scene })), reasons: r.reasons ?? [], note: r.note ?? "" };
  if (r.rating >= 4) { feedback.liked.push(entry); liked++; }
  else if (r.rating <= 2) { feedback.rejected.push(entry); rejected++; }
}

fs.writeFileSync(feedbackPath, JSON.stringify(feedback, null, 2) + "\n");
console.log(`Added ${liked} liked and ${rejected} rejected. Totals: ${feedback.liked.length} liked, ${feedback.rejected.length} rejected.`);
