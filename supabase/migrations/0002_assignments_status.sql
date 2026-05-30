-- ============================================================
-- 0002 — Status op toewijzingen (zelf-inschrijven + goedkeuren)
-- ============================================================
-- Studenten schrijven zichzelf in (status 'pending'); een admin
-- keurt goed (status 'approved'). Afgeleid uit het gebruik in
-- RoosterBeheer.tsx en MijnRooster.tsx.
-- ============================================================

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved'));

-- Studenten mogen zichzelf inschrijven (pending) en die weer verwijderen.
CREATE POLICY "assignments_insert_own_pending" ON assignments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "assignments_delete_own" ON assignments FOR DELETE
  USING (user_id = auth.uid());
