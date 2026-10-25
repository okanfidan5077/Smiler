-- Phase 1 schema: generation, two-stage approval, layout scoring, and (for Phase 3) the feed.
-- Applied by server/scripts/migrate.js. The pipeline service uses the service-role key (bypasses
-- RLS); the admin page signs in as a user listed in `admins`; the app will read published memes.

create extension if not exists vector;

-- ---------- access ----------
create table admins (
  user_id uuid primary key references auth.users on delete cascade
);

create function is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;

-- ---------- catalog: what the pipeline draws from ----------
create table sectors (
  id bigint generated always as identity primary key,
  name text not null unique,
  weight real not null default 1,
  active boolean not null default true
);

create table problems (
  id bigint generated always as identity primary key,
  sector_id bigint not null references sectors on delete cascade,
  description text not null,
  source text not null default 'llm' check (source in ('llm', 'manual')),
  times_used int not null default 0,
  unique (sector_id, description)
);

create table mechanics (
  id bigint generated always as identity primary key,
  name text not null unique,
  shape text not null,
  example text not null default '',
  active boolean not null default true
);

-- Layouts are the visual/joke structures (data/formats.json). prior_up/prior_down carry the
-- user's meme-lab ratings so scoring starts from what is already known.
create table layouts (
  id bigint generated always as identity primary key,
  name text not null unique,
  format text not null check (format in ('single', 'multi_panel', 'recast_template')),
  layout text not null,
  source text not null default 'catalog' check (source in ('catalog', 'writer', 'manual')),
  active boolean not null default true,
  prior_up real not null default 0,
  prior_down real not null default 0,
  created_at timestamptz not null default now()
);

create table characters (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null,
  reference_image_url text,
  created_at timestamptz not null default now()
);

-- ---------- generation ----------
create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'text' check (kind in ('text', 'image')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  config jsonb not null default '{}',
  params jsonb not null default '{}',
  seeds jsonb not null default '[]',
  stats jsonb not null default '{}',
  cost_usd numeric not null default 0,
  tokens int not null default 0,
  errors jsonb not null default '[]',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- candidate: written but not picked (cut, failed the gate, or invalid); kept for analytics.
-- draft: picked by the pipeline, waiting for text approval. Then text_approved -> images_ready
-- -> approved -> published, or rejected at either approval stage.
create type meme_status as enum ('candidate', 'draft', 'text_approved', 'images_ready', 'approved', 'published', 'rejected');

create table memes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references generation_runs on delete set null,
  status meme_status not null default 'candidate',
  format text not null,
  layout text not null,
  template text not null default '',
  sector text not null,
  problem text not null default '',
  mechanic text not null,
  mode text not null default 'seeded' check (mode in ('seeded', 'free')),
  explore boolean not null default false,
  premise text not null,
  premise_tr text,
  invalid text,
  critic jsonb,
  explain jsonb,
  match jsonb,
  gate_passed boolean,
  embedding vector(768),
  publish_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memes_status_idx on memes (status, created_at);
create index memes_layout_idx on memes (layout);

create table panels (
  id bigint generated always as identity primary key,
  meme_id uuid not null references memes on delete cascade,
  position smallint not null check (position between 1 and 5),
  speaker text not null,
  line text not null,
  scene text not null,
  line_tr text,
  scene_tr text,
  image_prompt text,
  image_url text,
  unique (meme_id, position)
);

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger memes_touch before update on memes for each row execute function touch_updated_at();

-- ---------- approval feedback ----------
create table feedback (
  id bigint generated always as identity primary key,
  meme_id uuid not null references memes on delete cascade,
  stage text not null check (stage in ('text', 'image')),
  decision text not null check (decision in ('approve', 'reject')),
  reasons text[] not null default '{}',
  note text not null default '',
  original jsonb,
  edited jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index feedback_meme_idx on feedback (meme_id, created_at);

-- The latest decision per meme and stage (a meme can be re-decided).
create view latest_feedback with (security_invoker = true) as
select distinct on (meme_id, stage) *
from feedback
order by meme_id, stage, created_at desc;

-- Layout score = posterior mean of approval, (up + 1) / (up + down + 2), from priors plus text
-- approvals. The service deals layouts weighted by this score, so layouts you approve come up
-- more often while unproven ones (score 0.5) still get explored.
create view layout_scores with (security_invoker = true) as
select
  l.name, l.format, l.source, l.active,
  l.prior_up + coalesce(f.up, 0) as up,
  l.prior_down + coalesce(f.down, 0) as down,
  coalesce(f.up, 0) + coalesce(f.down, 0) as decisions,
  (l.prior_up + coalesce(f.up, 0) + 1) / (l.prior_up + coalesce(f.up, 0) + l.prior_down + coalesce(f.down, 0) + 2) as score
from layouts l
left join (
  select m.layout,
         count(*) filter (where lf.decision = 'approve') as up,
         count(*) filter (where lf.decision = 'reject') as down
  from latest_feedback lf join memes m on m.id = lf.meme_id
  where lf.stage = 'text'
  group by m.layout
) f on f.layout = l.name;

-- ---------- feed (Phase 3) ----------
create table reactions (
  meme_id uuid not null references memes on delete cascade,
  device_id uuid not null,
  type text not null check (type in ('like', 'unlike')),
  created_at timestamptz not null default now(),
  primary key (meme_id, device_id)
);

create table views (
  meme_id uuid not null references memes on delete cascade,
  device_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (meme_id, device_id)
);

-- ---------- row-level security ----------
alter table admins enable row level security;
alter table sectors enable row level security;
alter table problems enable row level security;
alter table mechanics enable row level security;
alter table layouts enable row level security;
alter table characters enable row level security;
alter table generation_runs enable row level security;
alter table memes enable row level security;
alter table panels enable row level security;
alter table feedback enable row level security;
alter table reactions enable row level security;
alter table views enable row level security;

create policy admins_self on admins for select using (user_id = auth.uid());

create policy admin_all on sectors for all using (is_admin()) with check (is_admin());
create policy admin_all on problems for all using (is_admin()) with check (is_admin());
create policy admin_all on mechanics for all using (is_admin()) with check (is_admin());
create policy admin_all on layouts for all using (is_admin()) with check (is_admin());
create policy admin_all on characters for all using (is_admin()) with check (is_admin());
create policy admin_all on generation_runs for all using (is_admin()) with check (is_admin());
create policy admin_all on memes for all using (is_admin()) with check (is_admin());
create policy admin_all on panels for all using (is_admin()) with check (is_admin());
create policy admin_all on feedback for all using (is_admin()) with check (is_admin());
create policy admin_read on reactions for select using (is_admin());
create policy admin_read on views for select using (is_admin());

-- The app (anonymous auth) may read published memes and their panels; reactions and views
-- policies come with the app in Phase 3.
create policy public_read on memes for select to anon, authenticated using (status = 'published');
create policy public_read on panels for select to anon, authenticated
  using (exists (select 1 from memes m where m.id = meme_id and m.status = 'published'));
