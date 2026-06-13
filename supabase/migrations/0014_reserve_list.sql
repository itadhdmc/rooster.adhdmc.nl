-- ============================================================
-- 0014 — Reservelijst per dienst
-- ============================================================
-- Naast goedkeuren (approved) en afwijzen (verwijderen) kan een
-- admin een aanvrager nu op de RESERVELIJST zetten: status 'reserve'.
-- Valt iemand uit, dan promoveert de admin een reserve naar 'approved'
-- (dat is gewoon een status-update — alle bestaande approve-logica,
-- e-mail en de maandlimiet-check gelden dan vanzelf).
--
-- Bewust minimaal en additief:
--   * De view shifts_with_assignments telt al ALLEEN 'approved' mee
--     voor assigned_count/open_spots, dus een reserve vult de dienst
--     niet en hoeft de view niet te wijzigen. assigned_students bevat
--     elke toewijzing mét status, dus reserves komen automatisch mee.
--   * enforce_monthly_hours_cap vuurt alleen WHEN NEW.status='approved'
--     — op reserve zetten kost geen uren; promoveren wél (juist).
--   * email_shift_approved/notify_spot_available werken ongewijzigd.
--   * notify_admin_pending guard't al op status='pending', dus een
--     directe reserve-insert geeft geen valse "nieuwe aanvraag".
-- ============================================================


-- ------------------------------------------------------------
-- 1. Status-domein uitbreiden met 'reserve'
-- ------------------------------------------------------------

ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_status_check
  CHECK (status IN ('pending', 'approved', 'reserve'));


-- ------------------------------------------------------------
-- 2. Nieuw notificatietype voor de student op de reservelijst
-- ------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'shift_approved', 'shift_rejected', 'shift_reserve', 'admin_pending',
    'spot_available', 'swap_request', 'swap_approved', 'swap_rejected'
  ));


-- ------------------------------------------------------------
-- 3. Meldingen bij statuswisselingen rond de reservelijst
-- ------------------------------------------------------------
-- Wijzigingen t.o.v. 0013:
--   * Goedgekeurd-melding nu bij ELKE overgang naar 'approved' (ook
--     vanaf 'reserve'), niet alleen vanaf 'pending'. Zo weet een
--     gepromoveerde reserve dat hij is ingeroosterd.
--   * Nieuwe melding wanneer iemand op de reservelijst wordt gezet.
--   * Afgewezen-melding blijft alleen bij het verwijderen van een
--     'pending' aanvraag (een reserve weghalen is stil).

CREATE OR REPLACE FUNCTION public.notify_assignment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_shift shifts%ROWTYPE;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status <> 'approved' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (NEW.user_id, 'shift_approved', 'Dienst goedgekeurd',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is goedgekeurd.');

    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'reserve' AND OLD.status <> 'reserve' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (NEW.user_id, 'shift_reserve', 'Op de reservelijst',
        'Je staat op de reservelijst voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || '). We benaderen je als er een plek vrijkomt.');

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'pending'
          -- Wie zichzelf afmeldt hoeft geen "afgewezen"-bericht.
          AND (auth.uid() IS NULL OR auth.uid() <> OLD.user_id) THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (OLD.user_id, 'shift_rejected', 'Dienst afgewezen',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is helaas afgewezen.');
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
$$;
