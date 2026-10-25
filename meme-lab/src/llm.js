// One entry point, several providers. Each call returns { data, usage }.
// usage = { input, output } token counts, used for cost estimates.

import Anthropic from "@anthropic-ai/sdk";

// Models that accept the server-side refusal fallback ("default" form).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

let anthropic;

export async function generateJSON(role, { system, user, schema, kind }) {
  switch (role.provider) {
    case "anthropic":
      return callAnthropic(role, system, user, schema);
    case "ollama":
      return callOllama(role, system, user, schema);
    case "mock":
      return callMock(kind, user);
    default:
      throw new Error(`Unknown provider: ${role.provider}`);
  }
}

async function callAnthropic(role, system, user, schema) {
  anthropic ??= new Anthropic();
  const params = {
    model: role.model,
    max_tokens: 32000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: {
      effort: role.effort ?? "high",
      format: { type: "json_schema", schema },
    },
  };
  if (FALLBACK_MODELS.has(role.model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const msg = await anthropic.beta.messages.stream(params).finalMessage();

  if (msg.stop_reason === "refusal") {
    throw new Error(`Model declined (${msg.stop_details?.category ?? "unknown"}): ${msg.stop_details?.explanation ?? ""}`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error("Response hit max_tokens");

  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return {
    data: JSON.parse(text),
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
  };
}

async function callOllama(role, system, user, schema) {
  const baseUrl = process.env.OLLAMA_URL ?? role.url ?? "http://localhost:11434";
  const body = {
    model: role.model,
    stream: false,
    format: schema,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    options: { temperature: role.temperature ?? 0.8, num_ctx: role.num_ctx ?? 16384 },
    keep_alive: role.keep_alive ?? "10m",
  };
  if (role.think !== undefined) body.think = role.think;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  let data;
  try {
    data = JSON.parse(json.message.content);
  } catch {
    // Some models ignore the schema when thinking is off (e.g. qwen3.6 on Ollama 0.30).
    throw new Error(`${role.model} returned non-JSON (try "think": true): ${json.message.content.slice(0, 80)}`);
  }
  return {
    data,
    usage: { input: json.prompt_eval_count ?? 0, output: json.eval_count ?? 0 },
  };
}

// Canned responses so the pipeline and report can be tested without any model.
function callMock(kind, user) {
  const usage = { input: 0, output: 0 };
  if (kind === "writer") {
    const sector = /Sector: (.*)/.exec(user)?.[1] ?? "office";
    const n = Number(/Write (\d+)/.exec(user)?.[1] ?? 3);
    const concepts = Array.from({ length: n }, (_, i) => ({
      format: "multi_panel",
      layout: ["Fixed It Dialogue", "Escalation Ladder", "Meeting Agenda", "New: Mock Relay"][i % 4],
      layout_description: i % 4 === 3 ? "Three panels: the same complaint is passed along a chain of desks." : "",
      template: "",
      sector,
      problem: `mock problem ${i + 1}`,
      mechanic: ["Absurd Fix", "Endless Cycle"][i % 2],
      explore: i % 2 === 1,
      premise: `Mock joke ${i + 1}: the fix removes the thing the ${sector} exists for.`,
      panels: [
        { speaker: "Manager", line: `Complaints at the ${sector} are up 300%.`, scene: "Manager pointing at a red chart." },
        { speaker: "Employee", line: "Fixed it.", scene: "Employee giving a thumbs up." },
        { speaker: "Employee", line: "I removed the complaint box.", scene: "Employee proudly holding a complaint box over a bin." },
      ],
    }));
    return { data: { concepts }, usage };
  }
  if (kind === "critic") {
    const ids = [...user.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
    const reviews = ids.map((id, i) => ({
      id, instant: 4, relatable: 4, twist: 3, tight: 4, visual_payoff: 3, not_mean: 5,
      overall: 8 - (i % 4), verdict: i % 4 < 2 ? "keep" : "cut",
      weakest_point: "Mock weakest point.", fix: "none",
    }));
    return { data: { reviews }, usage };
  }
  if (kind === "explainer") {
    return { data: { explanation: "The fix removes the feedback instead of the problem.", target: "metric-driven management", clarity: 5, smile: 3, confusing_parts: "none" }, usage };
  }
  return { data: { match: "yes", reason: "Same joke." }, usage };
}
