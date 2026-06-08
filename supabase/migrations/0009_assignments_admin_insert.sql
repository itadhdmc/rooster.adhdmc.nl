-- ============================================================
-- 0009 — Admins mogen toewijzingen toevoegen (direct inroosteren)
-- ============================================================
-- Studenten mogen zichzelf inschrijven (status 'pending') en admins mogen
-- bestaande toewijzingen wijzigen/verwijderen. Er ontbrak echter een INSERT-
-- regel voor admins, waardoor "direct inroosteren" faalde met:
--   new row violates row-level security policy for table "assignments"
--
-- Deze policy laat admins een toewijzing voor wie dan ook toevoegen.
-- ============================================================

DROP POLICY IF EXISTS "assignments_insert_admin" ON assignments;

CREATE POLICY "assignments_insert_admin" ON assignments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
