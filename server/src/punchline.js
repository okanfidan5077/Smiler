// "Regenerate punchline" for the admin page: three alternative final lines for a draft, written by
// the pipeline's writer model. The admin picks one (or edits it) before approving.

import { generateJSON } from "../../meme-lab/src/llm.js";
import { db, must } from "./db.js";
import { loadConfig } from "./text-run.js";

const schema = {
  type: "object",
  properties: { options: { type: "array", items: { type: "string" } } },
  required: ["options"],
  additionalProperties: false,
};

const system = `You punch up the final line of a workplace meme. Keep the premise, characters and setup; rewrite only the last panel's line. Each option must be shorter or sharper than the original, deadpan, plain English, punchline in the final words. No real brands, companies or people. Give 3 different options.`;

export async function punchlineOptions(memeId) {
  const meme = must(await db.from("memes").select("premise, sector, layout, panels(position, speaker, line, scene)").eq("id", memeId).single(), "load meme");
  const panels = meme.panels.sort((a, b) => a.position - b.position);
  const { data } = await generateJSON(
    { ...loadConfig().writer, temperature: 1.0 },
    {
      system,
      user: JSON.stringify({ sector: meme.sector, layout: meme.layout, premise: meme.premise, panels: panels.map(({ speaker, line, scene }) => ({ speaker, line, scene })) }, null, 2),
      schema,
      kind: "punchline",
    },
  );
  return { position: panels.at(-1).position, options: data.options.slice(0, 3) };
}
