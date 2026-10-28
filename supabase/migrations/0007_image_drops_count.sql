-- A meme dropped at the image stage (status 'rejected', usually "not funny" once drawn) now
-- counts against its layout like a text rejection. Before, its text approval kept counting up.
-- up   = text-approved memes that are still alive (not rejected later)
-- down = text rejections + memes dropped after their text approval

drop view layout_scores;

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
         count(*) filter (where lf.decision = 'approve' and m.status <> 'rejected') as up,
         count(*) filter (where lf.decision = 'reject' or m.status = 'rejected') as down
  from latest_feedback lf join memes m on m.id = lf.meme_id
  where lf.stage = 'text'
  group by m.layout
) f on f.layout = l.name;
