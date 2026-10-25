// JSON schemas for structured output. Shared by every provider.

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const str = { type: "string" };
const int = { type: "integer" };

export const writerSchema = obj({
  concepts: {
    type: "array",
    items: obj({
      format: { type: "string", enum: ["single", "multi_panel", "recast_template"] },
      layout: { type: "string", description: "A catalog layout name, or \"New: <name>\" for an invented one" },
      layout_description: { type: "string", description: "For an invented layout: its structure in one sentence. Empty for catalog layouts." },
      template: { type: "string", description: "Template name for recast_template, otherwise empty" },
      sector: str,
      problem: str,
      mechanic: str,
      explore: { type: "boolean", description: "true for an experiment: a shape, mechanic or format the editor's liked list has not proven yet" },
      premise: str,
      panels: {
        type: "array",
        items: obj({ speaker: str, line: str, scene: str }),
      },
    }),
  },
});

export const criticSchema = obj({
  reviews: {
    type: "array",
    items: obj({
      id: str,
      instant: int,
      relatable: int,
      twist: int,
      tight: int,
      visual_payoff: int,
      not_mean: int,
      overall: int,
      verdict: { type: "string", enum: ["keep", "maybe", "cut"] },
      weakest_point: str,
      fix: str,
    }),
  },
});

export const explainerSchema = obj({
  explanation: str,
  target: str,
  clarity: int,
  smile: int,
  confusing_parts: str,
});

export const matcherSchema = obj({
  match: { type: "string", enum: ["yes", "partly", "no"] },
  reason: str,
});
