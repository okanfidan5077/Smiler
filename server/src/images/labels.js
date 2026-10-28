// Places a recast meme's labels on its characters. Each label (a panel: "The boyfriend: Rig
// Supervisor") is matched to an anchor from the template (layouts.anchors) and gets a position on
// one of the meme's images. The app and the admin page draw the label text there; images never
// contain text.
//
// Returns [{ position, image, x, y }] (position = panel position, image = 1-based image index),
// or [] when the layout has no anchors.

import { generateJSON } from "../../../meme-lab/src/llm.js";

const schema = {
  type: "object",
  properties: { matches: { type: "array", items: { type: "object", properties: { panel: { type: "integer" }, anchor: { type: "string" } }, required: ["panel", "anchor"], additionalProperties: false } } },
  required: ["matches"],
  additionalProperties: false,
};

const system = `You place the labels of a meme template on its picture. Each label belongs to one part of the picture (a person, an animal or an object). Match every label to exactly one anchor id from the list, using the label's speaker field ("The woman in red", "The boyfriend", "Button 1") and meaning. Use each anchor at most once unless there are more labels than anchors. Return one match per label.`;

// Captions and spoken lines stay under the image like any caption; only labels that name a part of
// the picture are placed on it (a Roll Safe "Caption" pinned onto the man read wrong).
const UNDER_IMAGE = /\b(caption|speech|bubble|says|said|quote|text|title|narrator)\b/i;

export async function placeLabels(role, meme, anchors) {
  if (!anchors?.length) return [];
  const panels = [...meme.panels].sort((a, b) => a.position - b.position).filter((p) => !UNDER_IMAGE.test(p.speaker));
  if (!panels.length) return [];
  const flat = anchors.flatMap((list, i) => list.map((a, j) => ({ id: `${i + 1}.${j + 1}`, image: i + 1, ...a })));
  const at = (p, a) => ({ position: p.position, image: a.image, x: a.x, y: a.y });

  // One label per image and one figure per image (Drake, Clown Makeup, Expanding Brain): label N
  // goes on image N, no model needed.
  if (panels.length === anchors.length && anchors.every((list) => list.length === 1)) {
    return panels.map((p, i) => at(p, flat[i]));
  }

  const { data } = await generateJSON({ ...role, temperature: 0 }, {
    system,
    user: JSON.stringify({
      labels: panels.map((p) => ({ panel: p.position, speaker: p.speaker, text: p.line })),
      anchors: flat.map(({ id, image, who }) => ({ id, image, who })),
    }, null, 2),
    schema,
    kind: "labels",
  });
  const byId = new Map(flat.map((a) => [a.id, a]));
  const used = new Set();
  return panels.map((p, i) => {
    const pick = byId.get(data.matches.find((m) => m.panel === p.position)?.anchor)
      // Fallback: the next unused anchor in order, so every label still gets a place.
      ?? flat.find((a) => !used.has(a.id))
      ?? flat[i % flat.length];
    used.add(pick.id);
    return at(p, pick);
  });
}
