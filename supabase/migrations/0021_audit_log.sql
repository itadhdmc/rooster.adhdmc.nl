-- ============================================================
-- 0021 — Logboek (audit log) voor roosterwijzigingen
-- ============================================================
-- Houdt bij wie wat wanneer wijzigde in het rooster: aanmeldingen,
-- goedkeuren/afwijzen, reservelijst-acties, werktijd-aanpassingen,
-- aanwezigheid, diensten toevoegen/wijzigen/verwijderen en ruilacties.
-- Alleen admins kunnen het logboek lezen; schrijven gebeurt uitsluitend
-- via SECURITY DEFINER-triggers.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_name  text NOT NULL,
  action      text NOT NULL,
  description text NOT NULL,
  shift_date  date,
  shift_type  text,
  target_name text
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log (occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_select_admin" ON audit_log;
CREATE POLICY "audit_select_admin" ON audit_log FOR SELECT USING (is_admin());
-- Geen insert/update/delete-policies: alleen de definer-triggers schrijven.

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_actor_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(full_name, email) FROM profiles WHERE id = auth.uid()),
    'systeem'
  );
$$;

CREATE OR REPLACE FUNCTION public.log_roster_event(
  p_action text, p_description text,
  p_shift_date date DEFAULT NULL, p_shift_type text DEFAULT NULL, p_target text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO audit_log (actor_id, actor_name, action, description, shift_date, shift_type, target_name)
  VALUES (auth.uid(), audit_actor_name(), p_action, p_description, p_shift_date, p_shift_type, p_target);
$$;

-- ------------------------------------------------------------
-- Toewijzingen (aanmelden, goedkeuren, reservelijst, tijden, ruil)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_shift  shifts%ROWTYPE;
    v_target text;
    v_old    text;
    v_id     uuid;
    v_shift_id uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN v_id := OLD.user_id; v_shift_id := OLD.shift_id;
    ELSE v_id := NEW.user_id; v_shift_id := NEW.shift_id; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = v_shift_id;
    -- Cascade bij dienst-verwijdering: de dienst zelf wordt al gelogd.
    IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
    SELECT COALESCE(full_name, email) INTO v_target FROM profiles WHERE id = v_id;
    v_target := COALESCE(v_target, 'onbekend');

    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'pending' THEN
        PERFORM log_roster_event('aanmelding', v_target || ' heeft zich aangemeld', v_shift.shift_date, v_shift.shift_type, v_target);
      ELSIF NEW.status = 'approved' THEN
        PERFORM log_roster_event('ingeroosterd', v_target || ' direct ingeroosterd', v_shift.shift_date, v_shift.shift_type, v_target);
      ELSIF NEW.status = 'reserve' THEN
        PERFORM log_roster_event('reservelijst', v_target || ' op de reservelijst gezet', v_shift.shift_date, v_shift.shift_type, v_target);
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status <> OLD.status THEN
        IF NEW.status = 'approved' AND OLD.status = 'reserve' THEN
          PERFORM log_roster_event('ingeroosterd', v_target || ' ingepland vanaf de reservelijst', v_shift.shift_date, v_shift.shift_type, v_target);
        ELSIF NEW.status = 'approved' THEN
          PERFORM log_roster_event('ingeroosterd', 'Aanmelding van ' || v_target || ' goedgekeurd', v_shift.shift_date, v_shift.shift_type, v_target);
        ELSIF NEW.status = 'reserve' THEN
          PERFORM log_roster_event('reservelijst', v_target || ' op de reservelijst gezet', v_shift.shift_date, v_shift.shift_type, v_target);
        END IF;
      END IF;

      IF NEW.user_id <> OLD.user_id THEN
        SELECT COALESCE(full_name, email) INTO v_old FROM profiles WHERE id = OLD.user_id;
        PERFORM log_roster_event('ruil', 'Dienst overgedragen van ' || COALESCE(v_old, 'onbekend') || ' naar ' || v_target || ' (ruil)', v_shift.shift_date, v_shift.shift_type, v_target);
      END IF;

      IF NEW.attendance IS DISTINCT FROM OLD.attendance THEN
        PERFORM log_roster_event('aanwezigheid', 'Aanwezigheid van ' || v_target || ' gezet op "' || NEW.attendance || '"', v_shift.shift_date, v_shift.shift_type, v_target);
      END IF;

      IF NEW.custom_start_time IS DISTINCT FROM OLD.custom_start_time
         OR NEW.custom_end_time IS DISTINCT FROM OLD.custom_end_time THEN
        IF NEW.custom_start_time IS NULL THEN
          PERFORM log_roster_event('werktijden', 'Werktijden van ' || v_target || ' teruggezet naar standaard', v_shift.shift_date, v_shift.shift_type, v_target);
        ELSE
          PERFORM log_roster_event('werktijden', 'Werktijden van ' || v_target || ' aangepast naar ' ||
            left(NEW.custom_start_time::text, 5) || '–' || left(NEW.custom_end_time::text, 5), v_shift.shift_date, v_shift.shift_type, v_target);
        END IF;
      END IF;

    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.status = 'pending' THEN
        IF auth.uid() = OLD.user_id THEN
          PERFORM log_roster_event('aanmelding', v_target || ' heeft de aanmelding ingetrokken', v_shift.shift_date, v_shift.shift_type, v_target);
        ELSE
          PERFORM log_roster_event('afgewezen', 'Aanmelding van ' || v_target || ' afgewezen', v_shift.shift_date, v_shift.shift_type, v_target);
        END IF;
      ELSIF OLD.status = 'approved' THEN
        PERFORM log_roster_event('verwijderd', v_target || ' van de dienst gehaald', v_shift.shift_date, v_shift.shift_type, v_target);
      ELSIF OLD.status = 'reserve' THEN
        IF auth.uid() = OLD.user_id THEN
          PERFORM log_roster_event('reservelijst', v_target || ' heeft zich afgemeld van de reservelijst', v_shift.shift_date, v_shift.shift_type, v_target);
        ELSE
          PERFORM log_roster_event('reservelijst', v_target || ' van de reservelijst gehaald', v_shift.shift_date, v_shift.shift_type, v_target);
        END IF;
      END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
$$;

CREATE OR REPLACE TRIGGER assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION audit_assignments();

-- ------------------------------------------------------------
-- Diensten (toevoegen, tijden/max wijzigen, verwijderen)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM log_roster_event('dienst', 'Dienst aangemaakt (' ||
        left(NEW.start_time::text, 5) || '–' || left(NEW.end_time::text, 5) || ', max ' || NEW.max_students || ')',
        NEW.shift_date, NEW.shift_type, NULL);
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.start_time <> OLD.start_time OR NEW.end_time <> OLD.end_time OR NEW.max_students <> OLD.max_students THEN
        PERFORM log_roster_event('dienst', 'Dienst aangepast naar ' ||
          left(NEW.start_time::text, 5) || '–' || left(NEW.end_time::text, 5) || ', max ' || NEW.max_students,
          NEW.shift_date, NEW.shift_type, NULL);
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM log_roster_event('dienst', 'Dienst verwijderd', OLD.shift_date, OLD.shift_type, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
  END;
$$;

CREATE OR REPLACE TRIGGER shifts_audit
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION audit_shifts();

-- ------------------------------------------------------------
-- Ruilverzoeken
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_swaps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_req    text;
    v_tgt    text;
    v_shift  shifts%ROWTYPE;
  BEGIN
    SELECT COALESCE(full_name, email) INTO v_req FROM profiles WHERE id = NEW.requester_id;
    SELECT COALESCE(full_name, email) INTO v_tgt FROM profiles WHERE id = NEW.target_user_id;
    SELECT s.* INTO v_shift FROM shifts s
      JOIN assignments a ON a.shift_id = s.id
      WHERE a.id = NEW.requester_assignment_id;

    IF TG_OP = 'INSERT' THEN
      PERFORM log_roster_event('ruil', 'Ruilverzoek van ' || COALESCE(v_req, 'onbekend') || ' aan ' || COALESCE(v_tgt, 'onbekend'),
        v_shift.shift_date, v_shift.shift_type, v_tgt);
    ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
      IF NEW.status = 'employee_approved' THEN
        PERFORM log_roster_event('ruil', COALESCE(v_tgt, 'onbekend') || ' heeft het ruilverzoek van ' || COALESCE(v_req, 'onbekend') || ' geaccepteerd',
          v_shift.shift_date, v_shift.shift_type, v_tgt);
      ELSIF NEW.status = 'admin_approved' THEN
        PERFORM log_roster_event('ruil', 'Ruil tussen ' || COALESCE(v_req, 'onbekend') || ' en ' || COALESCE(v_tgt, 'onbekend') || ' definitief goedgekeurd',
          v_shift.shift_date, v_shift.shift_type, v_tgt);
      ELSIF NEW.status = 'rejected' THEN
        PERFORM log_roster_event('ruil', 'Ruilverzoek van ' || COALESCE(v_req, 'onbekend') || ' afgewezen',
          v_shift.shift_date, v_shift.shift_type, v_tgt);
      END IF;
    END IF;

    RETURN NEW;
  END;
$$;

CREATE OR REPLACE TRIGGER swaps_audit
  AFTER INSERT OR UPDATE ON shift_swaps
  FOR EACH ROW EXECUTE FUNCTION audit_swaps();
