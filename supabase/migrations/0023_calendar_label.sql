-- ============================================================
-- 0023 — Instelbaar agenda-label
-- ============================================================
-- De titel van Google Agenda-afspraken ("Ochtenddienst – <label>")
-- komt voortaan uit de instellingen. De opruimlogica in de frontend
-- blijft het oude label ("ADHDMC Zorgadministratie") altijd
-- herkennen, zodat bestaande afspraken opgeruimd kunnen worden.
-- ============================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS calendar_label text NOT NULL DEFAULT 'ADHDMC Zorgadministratie';
