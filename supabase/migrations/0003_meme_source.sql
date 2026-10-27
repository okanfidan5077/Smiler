-- Where a meme came from. 'pipeline' memes come from the service; 'meme-lab' memes were rated
-- 4-5 in the Phase 0 blind rounds and imported as approved (their ratings already count as layout
-- priors, so they get no feedback rows). lab_key = "<run started>/<concept id>" keeps imports idempotent.

alter table memes add column source text not null default 'pipeline' check (source in ('pipeline', 'meme-lab'));
alter table memes add column lab_key text unique;
alter table memes add column lab_rating smallint;
alter table memes add column lab_note text not null default '';
alter table memes add column writer text;
