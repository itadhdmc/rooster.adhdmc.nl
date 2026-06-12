-- ============================================================
-- 0005 — Definities uit de live database (gedumpt 11-06-2026)
-- ============================================================
-- Deze objecten bestonden alleen in de live database en zijn op
-- 11-06-2026 gedumpt en hier vastgelegd, zodat de database vanaf nul
-- reproduceerbaar is. NIET nogmaals op de live database draaien
-- (alles bestaat daar al); alleen voor verse omgevingen.
--
-- Let op: execute_shift_swap en notify_assignment_status zijn later
-- vervangen door veiligere versies in 0013 — hier staan de versies
-- zoals ze op de dumpdatum live stonden, zodat de historie klopt.
-- De CREATE TRIGGER-statements zijn afgeleid uit de functies
-- (de dump bevatte alleen de functie-bodies).
-- ============================================================


-- ------------------------------------------------------------
-- TABEL: pending_students (uitnodigingen vóór eerste login)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pending_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pending_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_admin" ON pending_students FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));


-- ------------------------------------------------------------
-- TABEL: app_config (o.a. resend_api_key voor e-mail)
-- Kolommen afgeleid uit gebruik in email_shift_approved.
-- RLS wordt in 0013 aangezet.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT
);


-- ------------------------------------------------------------
-- VIEW: shifts_with_assignments (live versie, telt alleen approved)
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW shifts_with_assignments AS
SELECT s.id,
    s.period_id,
    s.shift_date,
    s.shift_type,
    s.start_time,
    s.end_time,
    s.duration_hours,
    s.max_students,
    s.created_at,
    rp.year,
    rp.month,
    count(a.id) FILTER (WHERE a.status = 'approved'::text) AS assigned_count,
    s.max_students - count(a.id) FILTER (WHERE a.status = 'approved'::text) AS open_spots,
    array_agg(json_build_object('user_id', a.user_id, 'full_name', p.full_name, 'email', p.email, 'assignment_id', a.id, 'status', COALESCE(a.status, 'approved'::text))) FILTER (WHERE a.id IS NOT NULL) AS assigned_students
   FROM shifts s
     JOIN roster_periods rp ON s.period_id = rp.id
     LEFT JOIN assignments a ON s.id = a.shift_id
     LEFT JOIN profiles p ON a.user_id = p.id
  GROUP BY s.id, rp.year, rp.month;


-- ------------------------------------------------------------
-- RPC: claim_pending_student — koppelt uitnodiging aan account
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_pending_student()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_email TEXT;
    v_name  TEXT;
    v_pid   UUID;
  BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    SELECT id, full_name INTO v_pid, v_name
      FROM pending_students WHERE lower(email) = lower(v_email) LIMIT 1;
    IF v_pid IS NOT NULL THEN
      UPDATE profiles
        SET full_name = COALESCE(NULLIF(full_name, ''), v_name)
        WHERE id = auth.uid();
      DELETE FROM pending_students WHERE id = v_pid;
    END IF;
  END;
  $function$;


-- ------------------------------------------------------------
-- RPC's voor het ruilen van diensten
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_swappable_assignments()
 RETURNS TABLE(assignment_id uuid, user_id uuid, full_name text, shift_date date, shift_type text, start_time time without time zone, end_time time without time zone, duration_hours numeric)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT a.id, a.user_id, p.full_name, s.shift_date, s.shift_type, s.start_time, s.end_time, s.duration_hours
    FROM assignments a
    JOIN profiles p ON p.id = a.user_id
    JOIN shifts s ON s.id = a.shift_id
    WHERE a.status = 'approved' AND a.user_id != auth.uid() AND s.shift_date >= CURRENT_DATE
    ORDER BY s.shift_date, s.shift_type;
  $function$;

CREATE OR REPLACE FUNCTION public.get_my_swaps()
 RETURNS TABLE(id uuid, requester_id uuid, requester_name text, target_user_id uuid, target_name text, requester_assignment_id uuid, target_assignment_id uuid, status text, created_at timestamp with time zone, req_shift_date date, req_shift_type text, req_start_time time without time zone, tgt_shift_date date, tgt_shift_type text, tgt_start_time time without time zone)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT ss.id, ss.requester_id, rp.full_name, ss.target_user_id, tp.full_name,
      ss.requester_assignment_id, ss.target_assignment_id, ss.status, ss.created_at,
      rs.shift_date, rs.shift_type, rs.start_time,
      ts.shift_date, ts.shift_type, ts.start_time
    FROM shift_swaps ss
    JOIN profiles rp ON rp.id = ss.requester_id
    JOIN profiles tp ON tp.id = ss.target_user_id
    JOIN assignments ra ON ra.id = ss.requester_assignment_id
    JOIN shifts rs ON rs.id = ra.shift_id
    JOIN assignments ta ON ta.id = ss.target_assignment_id
    JOIN shifts ts ON ts.id = ta.shift_id
    WHERE (ss.requester_id = auth.uid() OR ss.target_user_id = auth.uid())
      AND ss.status IN ('pending', 'employee_approved')
    ORDER BY ss.created_at DESC;
  $function$;

CREATE OR REPLACE FUNCTION public.get_employee_approved_swaps()
 RETURNS TABLE(id uuid, requester_name text, target_name text, requester_assignment_id uuid, target_assignment_id uuid, req_shift_date date, req_shift_type text, tgt_shift_date date, tgt_shift_type text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT ss.id, rp.full_name, tp.full_name,
      ss.requester_assignment_id, ss.target_assignment_id,
      rs.shift_date, rs.shift_type, ts.shift_date, ts.shift_type, ss.created_at
    FROM shift_swaps ss
    JOIN profiles rp ON rp.id = ss.requester_id
    JOIN profiles tp ON tp.id = ss.target_user_id
    JOIN assignments ra ON ra.id = ss.requester_assignment_id
    JOIN shifts rs ON rs.id = ra.shift_id
    JOIN assignments ta ON ta.id = ss.target_assignment_id
    JOIN shifts ts ON ts.id = ta.shift_id
    WHERE ss.status = 'employee_approved'
    ORDER BY ss.created_at;
  $function$;

-- ⚠️ Historische versie — VERVANGEN in 0013 (admin-check,
-- consistentie-checks en reset van afwijkende werktijden).
CREATE OR REPLACE FUNCTION public.execute_shift_swap(swap_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
  DECLARE
    v_swap shift_swaps;
    v_req_shift UUID; v_tgt_shift UUID;
  BEGIN
    SELECT * INTO v_swap FROM shift_swaps WHERE id = swap_id AND status = 'employee_approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'Swap niet gevonden'; END IF;
    SELECT shift_id INTO v_req_shift FROM assignments WHERE id = v_swap.requester_assignment_id;
    SELECT shift_id INTO v_tgt_shift FROM assignments WHERE id = v_swap.target_assignment_id;
    UPDATE assignments SET shift_id = v_tgt_shift, google_calendar_event_id = NULL
      WHERE id = v_swap.requester_assignment_id;
    UPDATE assignments SET shift_id = v_req_shift, google_calendar_event_id = NULL
      WHERE id = v_swap.target_assignment_id;
    UPDATE shift_swaps SET status = 'admin_approved' WHERE id = swap_id;
  END;
  $function$;


-- ------------------------------------------------------------
-- Notificatie-triggers (in-app inbox)
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
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (
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

-- ⚠️ Historische versie — VERVANGEN in 0013 (geen "afgewezen"-melding
-- meer bij eigen afmelding).
CREATE OR REPLACE FUNCTION public.notify_assignment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'pending' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (OLD.user_id, 'shift_rejected', 'Dienst afgewezen',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is helaas afgewezen.');
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.notify_spot_available()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_shift   shifts%ROWTYPE;
    v_period  roster_periods%ROWTYPE;
    v_student RECORD;
    v_spots   int;
  BEGIN
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
    SELECT * INTO v_period FROM roster_periods WHERE id = v_shift.period_id;

    SELECT COUNT(*) INTO v_spots
    FROM assignments WHERE shift_id = OLD.shift_id AND status = 'approved';

    IF v_spots < v_shift.max_students AND (v_period.availability_open OR v_period.second_round_open) THEN
      FOR v_student IN SELECT id FROM profiles WHERE role = 'student' AND active = true LOOP
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (
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

    INSERT INTO notifications (user_id, type, title, body)
    VALUES (
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
      INSERT INTO notifications (user_id, type, title, body)
      VALUES
        (NEW.requester_id, 'swap_approved', 'Ruil goedgekeurd',
         'Je ruilverzoek is goedgekeurd door de admin. Je rooster is bijgewerkt.'),
        (NEW.target_user_id, 'swap_approved', 'Ruil goedgekeurd',
         'De ruil met je collega is goedgekeurd door de admin. Je rooster is bijgewerkt.');
    ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
      INSERT INTO notifications (user_id, type, title, body)
      VALUES
        (NEW.requester_id, 'swap_rejected', 'Ruil afgewezen',
         'Je ruilverzoek is helaas afgewezen door de admin.'),
        (NEW.target_user_id, 'swap_rejected', 'Ruil afgewezen',
         'De ruil met je collega is afgewezen door de admin.');
    END IF;
    RETURN NEW;
  END;
  $function$;


-- ------------------------------------------------------------
-- E-mail bij goedkeuring (via Resend; API-key in app_config)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_shift_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  DECLARE
    v_shift  shifts%ROWTYPE;
    v_email  text;
    v_name   text;
    v_key    text;
    v_datum  text;
  BEGIN
    IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
      RETURN NEW;
    END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
    SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = NEW.user_id;
    IF v_email IS NULL THEN RETURN NEW; END IF;

    v_datum := to_char(v_shift.shift_date, 'DD-MM-YYYY');

    PERFORM net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'from',    'ADHDMC Rooster <rooster@adhdmc.nl>',
        'to',      ARRAY[v_email],
        'subject', 'Dienst goedgekeurd – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je aanvraag voor de <strong>' || v_shift.shift_type || 'dienst</strong> op ' ||
                   '<strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   ') is goedgekeurd.</p>' ||
                   '<p>Bekijk je rooster: <a href="https://rooster.adhdmc.nl">rooster.adhdmc.nl</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>ADHDMC Roostersysteem</strong></p>'
      )
    );

    RETURN NEW;
  END;
  $function$;


-- ------------------------------------------------------------
-- Trigger-koppelingen (afgeleid; de dump bevatte alleen functies)
-- ------------------------------------------------------------

CREATE OR REPLACE TRIGGER assignments_notify_pending
  AFTER INSERT ON assignments
  FOR EACH ROW EXECUTE FUNCTION notify_admin_pending();

CREATE OR REPLACE TRIGGER assignments_notify_status
  AFTER UPDATE OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION notify_assignment_status();

CREATE OR REPLACE TRIGGER assignments_notify_spot
  AFTER DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION notify_spot_available();

CREATE OR REPLACE TRIGGER assignments_email_approved
  AFTER UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION email_shift_approved();

CREATE OR REPLACE TRIGGER swaps_notify_request
  AFTER INSERT ON shift_swaps
  FOR EACH ROW EXECUTE FUNCTION notify_swap_request();

CREATE OR REPLACE TRIGGER swaps_notify_approved
  AFTER UPDATE ON shift_swaps
  FOR EACH ROW EXECUTE FUNCTION notify_swap_approved();
