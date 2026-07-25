-- 0020_recommendation_localisation.sql
-- Governed AI recommendations were persisted as rendered Portuguese prose, so
-- an English or Spanish operator read Portuguese and the console could not
-- translate after the fact (docs/brand §2.4).
--
-- A recommendation now also carries the message key and its facts, letting the
-- client compose the sentence in the reader's own language. Both columns are
-- nullable and recommendation_text stays NOT NULL: rows written before this
-- migration keep rendering from their stored prose, and the client falls back
-- to it whenever a key is absent. Nothing is rewritten — the recommendation
-- record is append-only like every other history in the system.

ALTER TABLE recommendation
  ADD COLUMN IF NOT EXISTS recommendation_key text,
  ADD COLUMN IF NOT EXISTS recommendation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assumptions_key text;

COMMENT ON COLUMN recommendation.recommendation_key IS
  'Message catalogue key the client renders in the reader locale. NULL for rows written before 0020, which render from recommendation_text.';
COMMENT ON COLUMN recommendation.recommendation_params IS
  'Facts interpolated into recommendation_key (visual id, weight, dates). Data only — never rendered prose.';
COMMENT ON COLUMN recommendation.assumptions_key IS
  'Message catalogue key for the assumptions line. NULL falls back to assumptions.';
