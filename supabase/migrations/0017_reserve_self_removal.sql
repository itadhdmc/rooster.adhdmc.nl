-- ============================================================
-- 0017 — Zelf afmelden van de reservelijst + gerichte meldingen
-- ============================================================
-- Een medewerker kan zichzelf nu van de reservelijst halen (tot
-- 24 uur voor de start van de dienst; daarna alleen via de admin).
-- Daarnaast worden alle overgangen rond de reservelijst gemeld:
--   * reserve → approved: eigen tekst ("Ingepland vanaf de
--     reservelijst"), in-app én per e-mail.
--   * zelf afmelden van reserve: admins krijgen een in-app melding
--     (type 'reserve_withdrawn').
--   * door de admin van reserve verwijderd zonder inplannen: de
--     medewerker krijgt een in-app melding (type 'reserve_removed').
-- ============================================================


-- ------------------------------------------------------------
-- 1. RLS: eigen reserve-rij verwijderen mag tot 24u voor de dienst
-- ------------------------------------------------------------
-- De bestaande policy stond elke eigen delete toe; voor reserve
-- geldt voortaan de 24-uursgrens (in Nederlandse tijd, want
-- shift_date/start_time zijn lokale kloktijden).

DROP POLICY IF EXISTS "assignments_delete_own" ON assignments;
CREATE POLICY "assignments_delete_own" ON assignments FOR DELETE
  USING (
    user_id = auth.uid()
    AND (
      status <> 'reserve'
      OR EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.id = shift_id
          AND (s.shift_date + s.start_time)
              > (now() AT TIME ZONE 'Europe/Amsterdam') + interval '24 hours'
      )
    )
  );


-- ------------------------------------------------------------
-- 2. Nieuwe notificatietypes
-- ------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'shift_approved', 'shift_rejected', 'shift_reserve', 'admin_pending',
    'spot_available', 'swap_request', 'swap_approved', 'swap_rejected',
    'reserve_withdrawn', 'reserve_removed'
  ));


-- ------------------------------------------------------------
-- 3. Meldingen bij statuswisselingen
-- ------------------------------------------------------------
-- Wijzigingen t.o.v. 0014:
--   * reserve → approved krijgt een eigen tekst, zodat duidelijk is
--     dat er een plek is vrijgekomen.
--   * DELETE van een reserve-rij is niet langer stil: zelf afmelden
--     meldt aan de admins, verwijderen door de admin meldt aan de
--     medewerker.
--   * Guard op een verdwenen dienst (cascade-delete van de shift):
--     dan geen melding.

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
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (NEW.user_id, 'shift_approved', 'Ingepland vanaf de reservelijst',
          'Er is een plek vrijgekomen: je bent van de reservelijst gehaald en ingepland voor ' ||
          to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').');
      ELSE
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (NEW.user_id, 'shift_approved', 'Dienst goedgekeurd',
          'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
          ' (' || v_shift.shift_type || ') is goedgekeurd.');
      END IF;

    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'reserve' AND OLD.status <> 'reserve' THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
      IF NOT FOUND THEN RETURN NEW; END IF;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (NEW.user_id, 'shift_reserve', 'Op de reservelijst',
        'Je staat op de reservelijst voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || '). We benaderen je als er een plek vrijkomt.');

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'pending'
          -- Wie zichzelf afmeldt hoeft geen "afgewezen"-bericht.
          AND (auth.uid() IS NULL OR auth.uid() <> OLD.user_id) THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      IF NOT FOUND THEN RETURN OLD; END IF;
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (OLD.user_id, 'shift_rejected', 'Dienst afgewezen',
        'Je aanvraag voor ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') is helaas afgewezen.');

    ELSIF TG_OP = 'DELETE' AND OLD.status = 'reserve' THEN
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      IF NOT FOUND THEN RETURN OLD; END IF;

      IF auth.uid() = OLD.user_id THEN
        -- Zelf afgemeld: informeer de admins.
        SELECT full_name INTO v_name FROM profiles WHERE id = OLD.user_id;
        FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' AND active = true LOOP
          INSERT INTO notifications (user_id, type, title, body)
          VALUES (v_admin.id, 'reserve_withdrawn', 'Reserve afgemeld',
            COALESCE(v_name, 'Iemand') || ' heeft zich afgemeld van de reservelijst voor ' ||
            to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type || ').');
        END LOOP;
      ELSE
        -- Door de admin verwijderd zonder inplannen: informeer de medewerker.
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (OLD.user_id, 'reserve_removed', 'Van de reservelijst gehaald',
          'Je staat niet langer op de reservelijst voor ' ||
          to_char(v_shift.shift_date, 'DD-MM-YYYY') || ' (' || v_shift.shift_type ||
          '). Je hoeft hier geen rekening meer mee te houden.');
      END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
$$;


-- ------------------------------------------------------------
-- 4. E-mail: eigen tekst bij inplannen vanaf de reservelijst
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_shift_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  DECLARE
    v_shift   shifts%ROWTYPE;
    v_email   text;
    v_name    text;
    v_key     text;
    v_datum   text;
    v_subject text;
    v_intro   text;
  BEGIN
    IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
      RETURN NEW;
    END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = NEW.user_id;
    IF v_email IS NULL THEN RETURN NEW; END IF;

    v_datum := to_char(v_shift.shift_date, 'DD-MM-YYYY');

    IF OLD.status = 'reserve' THEN
      v_subject := 'Ingepland vanaf de reservelijst – ' || v_datum;
      v_intro   := '<p>Er is een plek vrijgekomen voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Je stond op de reservelijst en bent nu <strong>ingepland</strong>.</p>';
    ELSE
      v_subject := 'Dienst goedgekeurd – ' || v_datum;
      v_intro   := '<p>Je aanvraag voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   ') is goedgekeurd.</p>';
    END IF;

    PERFORM net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'from',    'ADHDMC Rooster <rooster@adhdmc.nl>',
        'to',      ARRAY[v_email],
        'subject', v_subject,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   v_intro ||
                   '<p>Bekijk je rooster: <a href="https://rooster.adhdmc.nl">rooster.adhdmc.nl</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>ADHDMC Roostersysteem</strong></p>'
      )
    );

    RETURN NEW;
  END;
  $function$;
