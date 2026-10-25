import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Reads the repo-root .env, but exposes only the public Supabase URL and anon key to the browser.
// The service-role key in the same file must never reach this page.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, host: "localhost" },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? ""),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY ?? ""),
      __SERVER_URL__: JSON.stringify(`http://localhost:${env.SERVER_PORT ?? 8787}`),
    },
  };
});
