// Local pipeline service. n8n calls it on a schedule; the admin page calls it for "generate now"
// and "regenerate punchline". Bound to loopback; Docker Desktop forwards host.docker.internal.
//
//   POST /runs/text        { seeds?, n?, keep?, rng?, wait? }  run the text pipeline
//   GET  /runs/current                                          is a run in progress?
//   POST /memes/:id/punchline                                   3 alternative final lines
//   GET  /health
//
// Every POST must send "X-Smiler: 1". A custom header forces a CORS preflight, which only the
// admin origin passes, so a random web page can't make the browser trigger runs.

import http from "node:http";
import { settings } from "./env.js";
import { runText } from "./text-run.js";
import { punchlineOptions } from "./punchline.js";

let current = null; // { started, params, promise }

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", settings.adminOrigin);
  res.setHeader("access-control-allow-headers", "content-type, x-smiler");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && req.headers["x-smiler"] !== "1") return send(res, 403, { error: "missing X-Smiler header" });

    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, running: !!current });

    if (req.method === "GET" && url.pathname === "/runs/current") {
      return send(res, 200, current ? { running: true, started: current.started, params: current.params } : { running: false });
    }

    if (req.method === "POST" && url.pathname === "/runs/text") {
      if (current) return send(res, 409, { error: "a run is already in progress", started: current.started });
      const body = await readBody(req);
      const params = {
        seeds: Math.min(Number(body.seeds ?? 6), 20),
        n: Math.min(Number(body.n ?? 10), 20),
        keep: Math.min(Number(body.keep ?? 2), 4),
        ...(body.rng !== undefined ? { rng: Number(body.rng) } : {}),
      };
      const started = new Date().toISOString();
      console.log(`${started} text run ${JSON.stringify(params)}`);
      const promise = runText({ ...params, log: (s) => process.stdout.write(s) }).finally(() => (current = null));
      current = { started, params, promise };
      // n8n waits for the result (wait: true, the default); the admin page starts it and polls.
      if (body.wait === false) {
        promise.catch((err) => console.error(`run failed: ${err.message}`));
        return send(res, 202, { started, params });
      }
      const result = await promise;
      console.log(`run done: ${JSON.stringify(result)}`);
      return send(res, 200, result);
    }

    const m = url.pathname.match(/^\/memes\/([0-9a-f-]{36})\/punchline$/);
    if (req.method === "POST" && m) return send(res, 200, await punchlineOptions(m[1]));

    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

// n8n's HTTP node waits for whole runs (about 5 minutes for 6 seeds).
server.requestTimeout = 0;
server.listen(settings.port, settings.host, () => console.log(`smiler server on http://${settings.host}:${settings.port} (config ${settings.config})`));
