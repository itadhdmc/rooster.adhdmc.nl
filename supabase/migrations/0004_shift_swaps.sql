-- ============================================================
-- 0004 — Ruilverzoeken tussen studenten
-- ============================================================
-- Gereconstrueerd uit src/types/index.ts (SwapDetail/SwapStatus) en
-- het gebruik in MijnRooster.tsx en Ruilverzoeken.tsx.
-- Flow: requester maakt verzoek (pending) -> doel-collega keurt goed
-- (employee_approved) -> admin keurt definitief goed (admin_approved)
-- via de RPC execute_shift_swap, of afgewezen (rejected).
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  requester_assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE NOT NULL,
  target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  target_assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'employee_approved', 'admin_approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shift_swaps_target_idx ON shift_swaps (target_user_id, status);
CREATE INDEX IF NOT EXISTS shift_swaps_requester_idx ON shift_swaps (requester_id, status);

ALTER TABLE shift_swaps ENABLE ROW LEVEL SECURITY;

-- Betrokkenen (aanvrager of doel) en admins zien het verzoek.
CREATE POLICY "swaps_select_involved" ON shift_swaps FOR SELECT
  USING (
    requester_id = auth.uid()
    OR target_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Aanvrager maakt een nieuw verzoek voor zijn eigen dienst.
CREATE POLICY "swaps_insert_requester" ON shift_swaps FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- Doel-collega mag goedkeuren/afwijzen; aanvrager mag annuleren (delete).
CREATE POLICY "swaps_update_target" ON shift_swaps FOR UPDATE
  USING (target_user_id = auth.uid() OR requester_id = auth.uid());

CREATE POLICY "swaps_delete_requester" ON shift_swaps FOR DELETE
  USING (requester_id = auth.uid());

CREATE POLICY "swaps_write_admin" ON shift_swaps FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
