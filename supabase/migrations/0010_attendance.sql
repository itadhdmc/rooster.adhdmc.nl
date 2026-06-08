-- ============================================================
-- 0010 — Aanwezigheid per dienst (voor zuivere urenregistratie)
-- ============================================================
-- Een goedgekeurde dienst telt standaard als 'gewerkt'. De admin kan een
-- dienst markeren als 'ziek' of 'afwezig' (no-show), zodat die niet als
-- gewerkt meetelt in de urenexport, maar wel zichtbaar blijft voor HR.
-- ============================================================

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS attendance text NOT NULL DEFAULT 'gewerkt'
  CHECK (attendance IN ('gewerkt', 'ziek', 'afwezig'));
