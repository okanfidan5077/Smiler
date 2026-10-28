-- Phase 2: drawn images. A meme has 1-5 images in reveal order (multi-panel: one per panel;
-- singles: one; recast templates: per blueprint). Files live in the public 'memes' Storage bucket
-- under random paths (memes/<meme id>/<uuid>.jpg): the app needs public URLs for published memes,
-- and unpublished images can't be listed or guessed. Only the service (service key) writes.

insert into storage.buckets (id, name, public)
values ('memes', 'memes', true)
on conflict (id) do nothing;

create table meme_images (
  id bigint generated always as identity primary key,
  meme_id uuid not null references memes on delete cascade,
  position smallint not null check (position between 1 and 5),
  url text not null,
  path text not null,
  prompt text,
  seed bigint,
  model text,
  width int,
  height int,
  created_at timestamptz not null default now(),
  unique (meme_id, position)
);

-- The art director's cast sheet and setting, kept so a redraw can reuse or vary it.
alter table memes add column art jsonb;

alter table meme_images enable row level security;
create policy admin_all on meme_images for all using (is_admin()) with check (is_admin());
create policy public_read on meme_images for select to anon, authenticated
  using (exists (select 1 from memes m where m.id = meme_id and m.status = 'published'));
