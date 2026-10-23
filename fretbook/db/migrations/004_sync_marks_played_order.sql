-- Sync marks keyed by played-bar index rather than written bar index.
--
-- Repeats were previously stored but not rendered, so existing marks were
-- keyed by written bar index (which was equal to played bar index). Mark
-- existing tab documents as keyed_by = 'played'.

UPDATE songs
SET document = json_set(document, '$.sync.keyed_by', 'played')
WHERE content_kind = 'tab'
  AND document IS NOT NULL
  AND json_extract(document, '$.sync') IS NOT NULL;
