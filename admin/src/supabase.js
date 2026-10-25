import { createClient } from "@supabase/supabase-js";

/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__, __SERVER_URL__ */
export const configured = Boolean(__SUPABASE_URL__ && __SUPABASE_ANON_KEY__ && !__SUPABASE_URL__.includes("your-"));
export const supabase = configured ? createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__) : null;

// The local pipeline service (server/). The custom header makes the browser send a CORS preflight
// that only this page's origin passes.
export async function callServer(path, body) {
  const res = await fetch(`${__SERVER_URL__}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-smiler": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `server ${res.status}`);
  return data;
}

export const TEXT_CHIPS = ["not funny", "unclear", "seen it", "weak punchline", "too mean", "wrong format", "too long"];
