// Minimal ComfyUI HTTP client: queue an API-format graph, wait for it, download the outputs.
// ComfyUI runs locally (COMFY_URL, default http://127.0.0.1:8188).

const base = () => process.env.COMFY_URL ?? "http://127.0.0.1:8188";

export async function comfyUp() {
  try {
    const res = await fetch(`${base()}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// VRAM sequencing: unload ComfyUI's models so Gemma (Ollama) has the GPU for the next text run.
export async function freeMemory() {
  await fetch(`${base()}/free`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {});
}

// Uploads a PNG so LoadImage can use it (reference panel for Qwen-Image-Edit).
export async function uploadImage(buffer, name) {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: "image/png" }), name);
  form.append("overwrite", "true");
  const res = await fetch(`${base()}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ComfyUI upload ${res.status}: ${await res.text()}`);
  return (await res.json()).name;
}

// Queues a graph and resolves with the PNG buffers of its SaveImage outputs.
export async function render(graph, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const res = await fetch(`${base()}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "smiler" }),
  });
  const queued = await res.json();
  if (!res.ok || queued.error) throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(queued.error ?? queued.node_errors ?? queued).slice(0, 600)}`);

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const hist = await (await fetch(`${base()}/history/${queued.prompt_id}`)).json();
    const entry = hist[queued.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      const msg = entry.status.messages?.find((m) => m[0] === "execution_error")?.[1];
      throw new Error(`ComfyUI failed: ${msg?.exception_message ?? JSON.stringify(entry.status).slice(0, 400)}`);
    }
    if (!entry.status?.completed) continue;
    const images = Object.values(entry.outputs).flatMap((o) => o.images ?? []);
    return Promise.all(
      images.map(async (img) => {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
        return Buffer.from(await (await fetch(`${base()}/view?${q}`)).arrayBuffer());
      }),
    );
  }
  throw new Error("ComfyUI render timed out");
}
