-- Label anchors for recast templates (meme-lab/data/anchors.json): per image, where each figure
-- stands (percent x/y). The app draws each label as a tag on its character instead of baking text
-- into the image (user choice 2026-10-29: "labels on the characters"). A meme's resolved label
-- positions live in memes.art.labels: [{ position, image, x, y }].
alter table layouts add column anchors jsonb;
