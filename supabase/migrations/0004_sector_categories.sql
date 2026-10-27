-- Sector filters for the app: each sector (job) belongs to a broader category, so readers can
-- pick "Healthcare" or narrow down to "dental clinic". memes.sector holds the canonical sector name.

alter table sectors add column category text not null default 'Other';

update sectors set category = c.category
from (values
  ('hospital', 'Healthcare'), ('pharmacy', 'Healthcare'), ('dental clinic', 'Healthcare'), ('veterinary clinic', 'Healthcare'),
  ('software team', 'Office & Tech'), ('call center', 'Office & Tech'), ('law firm', 'Office & Tech'), ('bank branch', 'Office & Tech'), ('newspaper', 'Office & Tech'),
  ('city hall', 'Public Service'), ('police station', 'Public Service'), ('fire station', 'Public Service'), ('post office', 'Public Service'),
  ('primary school', 'Education'), ('university', 'Education'),
  ('construction site', 'Industry & Logistics'), ('car factory', 'Industry & Logistics'), ('oil rig', 'Industry & Logistics'),
  ('warehouse and logistics', 'Industry & Logistics'), ('cargo ship', 'Industry & Logistics'),
  ('dairy farm', 'Farming & Animals'), ('zoo', 'Farming & Animals'),
  ('airline', 'Travel & Hospitality'), ('hotel', 'Travel & Hospitality'), ('restaurant kitchen', 'Travel & Hospitality'),
  ('supermarket', 'Retail & Leisure'), ('gym', 'Retail & Leisure'), ('film set', 'Retail & Leisure')
) as c(name, category)
where sectors.name = c.name;

-- Early meme-lab rounds stored the writer's own spelling ("Warehouse/Logistics", "Fire Station").
update memes m set sector = s.name
from sectors s
where m.sector <> s.name
  and lower(replace(replace(m.sector, '/', ' and '), '&', 'and')) = s.name;

-- The app (Phase 3) reads published memes with their category through this view.
create view meme_categories with (security_invoker = true) as
select m.id as meme_id, m.sector, coalesce(s.category, 'Other') as category
from memes m left join sectors s on s.name = m.sector;

-- Sector names and categories are not secret; the app needs them for its filter list.
create policy public_read on sectors for select to anon, authenticated using (active);
