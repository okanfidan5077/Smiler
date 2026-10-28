-- Visual blueprints for recast templates (meme-lab/data/compositions.json): one description per
-- separate image, in reveal order. The image art director follows them; null for other layouts.
alter table layouts add column composition jsonb;
