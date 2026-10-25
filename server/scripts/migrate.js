// Applies supabase/migrations/*.sql in order, once each, and registers ADMIN_EMAIL as admin.
//
//   npm run migrate
//
// Needs DATABASE_URL (Supabase: Project Settings > Database > Connection string, URI).

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { repoRoot, need } from "../src/env.js";

const sql = postgres(need("DATABASE_URL"), { onnotice: () => {}, max: 1 });
const dir = path.join(repoRoot, "supabase/migrations");

try {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from _migrations`).map((r) => r.name));
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    process.stdout.write(`applying ${name} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, name), "utf8"));
      await tx`insert into _migrations (name) values (${name})`;
    });
    console.log("ok");
  }
  // RLS keeps the bookkeeping table away from the public API.
  await sql`alter table _migrations enable row level security`;

  const email = process.env.ADMIN_EMAIL;
  if (email) {
    const rows = await sql`insert into admins (user_id) select id from auth.users where lower(email) = lower(${email})
                           on conflict do nothing returning user_id`;
    const exists = await sql`select 1 from admins a join auth.users u on u.id = a.user_id where lower(u.email) = lower(${email})`;
    console.log(exists.length
      ? `admin ${email}: ${rows.length ? "registered" : "already registered"}`
      : `admin ${email}: no such user yet. Create it in Supabase (Authentication > Users > Add user), then run this again.`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
