-- ============================================================
-- 0013 — Opruimen van te ruime live-policies en RPC's
-- ============================================================
-- Gebaseerd op de dump van de live database (11-06-2026). Daaruit
-- bleek dat een aantal policies veel ruimer is dan bedoeld, en dat
-- execute_shift_swap door iedereen aan te roepen is. Deze migratie
-- wijzigt ALLEEN policies en functies — geen enkele rij data.
--
-- Gevonden gaten (allemaal hieronder gedicht):
--   1. KRITIEK: policy "profiles_all_admin" gold voor ELKE ingelogde
--      gebruiker (USING auth.uid() IS NOT NULL) — elke student kon
--      andermans profiel wijzigen én VERWIJDEREN (cascade: al hun
--      diensten/inschrijvingen weg). "profiles_insert_self" stond
--      bovendien elke insert toe (WITH CHECK true).
--   2. KRITIEK: execute_shift_swap (SECURITY DEFINER) had geen
--      admin-check — twee studenten konden een ruil definitief maken
--      zonder admin-goedkeuring.
--   3. HOOG: een ruilverzoek kon verwijzen naar andermans diensten
--      (geen eigendomscontrole bij INSERT) en de oude losse
--      "shift_swaps_update"-policy omzeilde de strikte uit 0011.
--   4. HOOG: app_config (met de Resend API-key) heeft geen RLS —
--      elke ingelogde gebruiker kon de mailsleutel uitlezen.
--   5. MIDDEL: "assignments_insert_student" miste de eis dat
--      studenten geen eigen (afwijkende) werktijden mogen meesturen.
--   6. KLEIN: wie zijn eigen aanvraag introk kreeg de melding
--      "je aanvraag is helaas afgewezen".
-- ============================================================


-- ------------------------------------------------------------
-- Hulpfunctie: admin-check zonder RLS-recursie
-- ------------------------------------------------------------
-- Nodig omdat een profiles-policy die zelf op profiles query't
-- oneindige recursie geeft. SECURITY DEFINER omzeilt RLS netjes.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;


-- ------------------------------------------------------------
-- 1. Profiles: alleen jezelf (naam) of admins
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_all_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON profiles;

-- Eigen profiel bijwerken (de trigger uit 0011 beschermt rol,
-- contracturen, actief en e-mail) — nodig voor de login-upsert.
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins zien en bewerken alle profielen (Studenten-pagina).
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- Blijven bestaan: profiles_select_own, profiles_insert_own
-- (alleen role='student', uit 0011) en profiles_delete_admin
-- (admins, maar nooit zichzelf).


-- ------------------------------------------------------------
-- 2 & 3. Ruilverzoeken: eigendom afdwingen + losse policy weg
-- ------------------------------------------------------------

-- De oude ruime update-policy omzeilde "swaps_update_target" uit 0011.
DROP POLICY IF EXISTS "shift_swaps_update" ON shift_swaps;

-- Admin moet wel kunnen afwijzen (en de RPC zet admin_approved).
DROP POLICY IF EXISTS "swaps_update_admin" ON shift_swaps;
CREATE POLICY "swaps_update_admin" ON shift_swaps FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- Een ruilverzoek moet over je EIGEN goedgekeurde dienst gaan en de
-- doeldienst moet echt van de doel-collega zijn (beide goedgekeurd).
DROP POLICY IF EXISTS "shift_swaps_insert" ON shift_swaps;
CREATE POLICY "shift_swaps_insert" ON shift_swaps FOR INSERT
  WITH CHECK (
    requester_id = auth.uid()
    AND target_user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM assignments a
      WHERE a.id = requester_assignment_id
        AND a.user_id = auth.uid()
        AND a.status = 'approved'
    )
    AND EXISTS (
      SELECT 1 FROM assignments a
      WHERE a.id = target_assignment_id
        AND a.user_id = target_user_id
        AND a.status = 'approved'
    )
  );

-- De ruil zelf: alleen admins, met consistentie-checks. Reset ook de
-- afwijkende werktijden (die horen bij de oude dienst) en het agenda-id
-- (zodat de sync de agenda's bijwerkt).
CREATE OR REPLACE FUNCTION execute_shift_swap(swap_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap shift_swaps;
  v_req  assignments;
  v_tgt  assignments;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Alleen admins kunnen een ruil definitief goedkeuren.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_swap FROM shift_swaps
  WHERE id = swap_id AND status = 'employee_approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ruilverzoek niet gevonden of nog niet door de collega goedgekeurd.';
  END IF;

  SELECT * INTO v_req FROM assignments WHERE id = v_swap.requester_assignment_id;
  SELECT * INTO v_tgt FROM assignments WHERE id = v_swap.target_assignment_id;

  IF v_req.user_id IS DISTINCT FROM v_swap.requester_id
     OR v_tgt.user_id IS DISTINCT FROM v_swap.target_user_id THEN
    RAISE EXCEPTION 'Ruilverzoek komt niet overeen met de huidige toewijzingen.';
  END IF;

  UPDATE assignments
    SET shift_id = v_tgt.shift_id,
        google_calendar_event_id = NULL,
        custom_start_time = NULL,
        custom_end_time = NULL
    WHERE id = v_req.id;

  UPDATE assignments
    SET shift_id = v_req.shift_id,
        google_calendar_event_id = NULL,
        custom_start_time = NULL,
        custom_end_time = NULL
    WHERE id = v_tgt.id;

  UPDATE shift_swaps SET status = 'admin_approved' WHERE id = swap_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. app_config (Resend API-key) afschermen
-- ------------------------------------------------------------
-- RLS aan zonder policies = alleen de service role en SECURITY
-- DEFINER-functies (zoals email_shift_approved) kunnen erbij.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_config'
  ) THEN
    EXECUTE 'ALTER TABLE app_config ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;


-- ------------------------------------------------------------
-- 5. Dubbele assignment-insertpolicy zonder werktijd-eis weg
-- ------------------------------------------------------------
-- "assignments_insert_own_pending" (0012) blijft: pending, eigen
-- account, géén zelf meegestuurde afwijkende werktijden.

DROP POLICY IF EXISTS "assignments_insert_student" ON assignments;


-- ------------------------------------------------------------
-- 6. Geen "afgewezen"-melding bij eigen afmelding
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_assignment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_shift shifts%ROWTYPE;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status = 'pending' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (NEW.user_id, 'shift_approved', 'Dienst goedgekeurd',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is goedgekeurd.');

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