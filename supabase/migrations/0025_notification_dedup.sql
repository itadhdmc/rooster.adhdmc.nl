-- ============================================================
-- 0025 — Meldingen: idempotentie / deduplicatie
-- ============================================================
-- Alle notificatietriggers gaan door één helper: notify_once().
-- Die slaat een melding over als er al een IDENTIEKE ONGELEZEN
-- melding voor die gebruiker staat. Zo kan dezelfde gebeurtenis
-- (bijv. herhaald aan-/afmelden, meerdere vrijgekomen plekken op
-- dezelfde dienst) nooit meer een stapel duplicaten veroorzaken.
-- Na het lezen kan dezelfde melding uiteraard opnieuw ontstaan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_once(p_user uuid, p_type text, p_title text, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = p_user AND type = p_type AND body = p_body AND read = false
    ) THEN
      RETURN;
    END IF;
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (p_user, p_type, p_title, p_body);
  END;
$$;

-- ------------------------------------------------------------
-- 1. Statuswisselingen van toewijzingen (versie 0017, nu via notify_once)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_assignment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_shift shifts%ROWTYPE;
    v_name  text;
    v_admin RECORD;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status <> 'approved' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      IF NOT FOUND THEN RETURN NEW; END IF;
      IF OLD.status = 'reserve' THEN
        PERFORM notify_once(NEW.user_id, 'shift_approved', 'Ingepland vanaf de reservelijst',
          'Er is een plek vrijgekomen: je bent van de reservelijst gehaald en ingepland voor ' ||
          to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').');
      ELSE
        PERFORM notify_once(NEW.user_id, 'shift_approved', 'Dienst goedgekeurd',
          'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
          ' (' || v_shift.shift_type || ') is goedgekeurd.');
      END IF;

    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'reserve' AND OLD.status <> 'reserve' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      IF NOT FOUND THEN RETURN NEW; END IF;
      PERFORM notify_once(NEW.user_id, 'shift_reserve', 'Op de reservelijst',
        'Je staat op de reservelijst voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || '). We benaderen je als er een plek vrijkomt.');

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'pending'
          -- Wie zichzelf afmeldt hoeft geen "afgewezen"-bericht.
          AND (auth.uid() IS NULL OR auth.uid() <> OLD.user_id) THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      IF NOT FOUND THEN RETURN OLD; END IF;
      PERFORM notify_once(OLD.user_id, 'shift_rejected', 'Dienst afgewezen',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is helaas afgewezen.');

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'reserve' THEN
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      IF NOT FOUND THEN RETURN OLD; END IF;

      IF auth.uid() = OLD.user_id THEN
        SELECT full_name INTO v_name FROM profiles WHERE id = OLD.user_id;
        FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' AND active = true LOOP
          PERFORM notify_once(v_admin.id, 'reserve_withdrawn', 'Reserve afgemeld',
            COALESCE(v_name, 'Iemand') || ' heeft zich afgemeld van de reservelijst voor ' ||
            to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').');
        END LOOP;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
        PERFORM notify_once(OLD.user_id, 'reserve_removed', 'Van de reservelijst gehaald',
          'Je staat niet langer op de reservelijst voor ' ||
          to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type ||
          '). Je hoeft hier geen rekening meer mee te houden.');
      END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
$$;

-- ------------------------------------------------------------
-- 2. Nieuwe aanvraag voor de admins
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_admin_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_shift  shifts%ROWTYPE;
    v_name   text;
    v_admin  RECORD;
  BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
    SELECT full_name INTO v_name FROM profiles WHERE id = NEW.user_id;

    FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' AND active = true LOOP
      PERFORM notify_once(
        v_admin.id,
        'admin_pending',
        'Nieuwe aanvraag',
        COALESCE(v_name, 'Iemand') || ' heeft zich aangemeld voor ' ||
        to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').'
      );
    END LOOP;

    RETURN NEW;
  END;
  $function$;

-- ------------------------------------------------------------
-- 3. Vrijgekomen plek (versie 0020, nu via notify_once)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_spot_available()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_shift    shifts%ROWTYPE;
    v_period   roster_periods%ROWTYPE;
    v_student  RECORD;
    v_admin    RECORD;
    v_spots    int;
    v_reserves int;
  BEGIN
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
    SELECT * INTO v_period FROM roster_periods WHERE id = v_shift.period_id;

    SELECT COUNT(*) INTO v_spots
    FROM assignments WHERE shift_id = OLD.shift_id AND status = 'approved';
    IF v_spots >= v_shift.max_students THEN RETURN OLD; END IF;

    SELECT COUNT(*) INTO v_reserves
    FROM assignments WHERE shift_id = OLD.shift_id AND status = 'reserve';

    IF v_reserves > 0 THEN
      FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' AND active = true LOOP
        PERFORM notify_once(
          v_admin.id,
          'spot_available',
          'Plek vrijgekomen — reserve beschikbaar',
          'Er is een plek vrijgekomen op ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
          ' (' || v_shift.shift_type || '). Er ' ||
          CASE WHEN v_reserves = 1 THEN 'staat 1 persoon'
               ELSE 'staan ' || v_reserves || ' personen' END ||
          ' op de reservelijst — inroosteren kan via Roosterbeheer.'
        );
      END LOOP;

    ELSIF v_period.availability_open OR v_period.second_round_open THEN
      FOR v_student IN SELECT id FROM profiles WHERE role = 'student' AND active = true LOOP
        PERFORM notify_once(
          v_student.id,
          'spot_available',
          'Vrije plek beschikbaar',
          'Er is een plek vrijgekomen op ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
          ' (' || v_shift.shift_type || '). Meld je snel aan!'
        );
      END LOOP;
    END IF;

    RETURN OLD;
  END;
  $function$;

-- ------------------------------------------------------------
-- 4. Ruilverzoeken
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_swap_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_name text;
    v_shift shifts%ROWTYPE;
  BEGIN
    SELECT full_name INTO v_name FROM profiles WHERE id = NEW.requester_id;
    SELECT s.* INTO v_shift FROM assignments a JOIN shifts s ON s.id = a.shift_id
      WHERE a.id = NEW.requester_assignment_id;

    PERFORM notify_once(
      NEW.target_user_id, 'swap_request', 'Ruilverzoek ontvangen',
      COALESCE(v_name, 'Een collega') || ' wil ruilen met jou voor ' ||
      to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').'
    );
    RETURN NEW;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.notify_swap_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  BEGIN
    IF NEW.status = 'admin_approved' AND OLD.status <> 'admin_approved' THEN
      PERFORM notify_once(NEW.requester_id, 'swap_approved', 'Ruil goedgekeurd',
        'Je ruilverzoek is goedgekeurd door de admin. Je rooster is bijgewerkt.');
      PERFORM notify_once(NEW.target_user_id, 'swap_approved', 'Ruil goedgekeurd',
        'De ruil met je collega is goedgekeurd door de admin. Je rooster is bijgewerkt.');
    ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
      PERFORM notify_once(NEW.requester_id, 'swap_rejected', 'Ruil afgewezen',
        'Je ruilverzoek is helaas afgewezen door de admin.');
      PERFORM notify_once(NEW.target_user_id, 'swap_rejected', 'Ruil afgewezen',
        'De ruil met je collega is afgewezen door de admin.');
    END IF;
    RETURN NEW;
  END;
  $function$;
