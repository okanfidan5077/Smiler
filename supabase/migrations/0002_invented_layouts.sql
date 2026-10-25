-- Writer-invented layouts ("New: <name>") carry a one-sentence structure description. When the
-- admin approves a meme in an invented layout, the layout joins the catalog (source 'writer') and
-- that approval counts toward its score, so the catalog grows from the model's own inventions.

alter table memes add column layout_description text not null default '';

create function promote_invented_layout() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m memes%rowtype;
  clean text;
begin
  if new.stage <> 'text' or new.decision <> 'approve' then return new; end if;
  select * into m from memes where id = new.meme_id;
  if m.layout !~* '^new:' then return new; end if;
  clean := btrim(regexp_replace(m.layout, '^new:\s*', '', 'i'));
  if clean = '' then return new; end if;
  insert into layouts (name, format, layout, source)
  values (clean, m.format, coalesce(nullif(m.layout_description, ''), m.premise), 'writer')
  on conflict (name) do nothing;
  -- Same name everywhere, so layout_scores counts this and earlier memes in the layout.
  update memes set layout = clean where layout = m.layout;
  return new;
end $$;

create trigger feedback_promote_layout after insert on feedback
for each row execute function promote_invented_layout();
