-- ============================================================
-- 0008 — Agenda-id veilig kunnen opslaan vanuit de app
-- ============================================================
-- Studenten mogen hun eigen toewijzing niet wijzigen (RLS), waardoor het
-- Google-agenda-id nooit werd opgeslagen. Daardoor maakte de app bij elke
-- login opnieuw agenda-afspraken aan -> duplicaten -> meerdere herinneringen.
--
-- Deze functie laat een student ALLEEN het agenda-id van zijn EIGEN
-- toewijzing zetten (geen andere kolommen, geen andermans rijen).
-- SECURITY DEFINER omzeilt RLS, maar de WHERE-clausule beperkt het netjes.
-- ============================================================

CREATE OR REPLACE FUNCTION set_calendar_event_id(p_assignment_id uuid, p_event_id text)
RETURNS void AS $$
BEGIN
  UPDATE assignments
  SET google_calendar_event_id = p_event_id
  WHERE id = p_assignment_id
    AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_calendar_event_id(uuid, text) TO authenticated;
