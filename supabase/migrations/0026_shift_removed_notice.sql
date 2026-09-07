-- ============================================================
-- 0026 — Bericht als je van een goedgekeurde dienst wordt gehaald
-- ============================================================
-- Uit de praktijk (7 sep 2026): een medewerker werd op 31 augustus
-- door een admin van vier ochtenddiensten gehaald en hoorde daar
-- niets over — geen melding, geen mail. Het enige signaal dat ze
-- kreeg was de herinnering uit haar eigen Google Agenda, en die
-- stond er nog omdat de agenda-afspraak niet was opgeruimd. Ze
-- stond dus op maandag voor niets op de stoep.
--
-- notify_assignment_status() dekte tot nu toe alleen het verwijderen
-- van 'pending' (afgewezen) en 'reserve' (van de reservelijst
-- gehaald). Het verwijderen van een 'approved' rij — precies de
-- ingrijpendste actie — was stil. Deze migratie voegt toe:
--   1. notificatietype 'shift_removed'
--   2. in-app melding bij DELETE van een goedgekeurde toewijzing
--   3. dezelfde melding per e-mail (net als 0018 voor de reservelijst)
--
-- Zelf afmelden en het verwijderen van de hele dienst (cascade)
-- blijven zonder bericht — bij een cascade bestaat de shift-rij al
-- niet meer, waar de functies op controleren.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Nieuw notificatietype
-- ------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'shift_approved', 'shift_rejected', 'shift_reserve', 'shift_removed',
    'admin_pending', 'spot_available', 'swap_request', 'swap_approved',
    'swap_rejected', 'reserve_withdrawn', 'reserve_removed'
  ));


-- ------------------------------------------------------------
-- 2. Melding bij statuswisselingen (versie 0025 + shift_removed)
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

    -- NIEUW: van een goedgekeurde dienst gehaald door iemand anders.
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'approved'
          AND (auth.uid() IS NULL OR auth.uid() <> OLD.user_id) THEN
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
      SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
      IF NOT FOUND THEN RETURN OLD; END IF;
      PERFORM notify_once(OLD.user_id, 'shift_removed', 'Dienst vervallen',
        'Je bent van de dienst op ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
        ' (' || v_shift.shift_type || ') gehaald. Je hoeft hier geen rekening meer mee te ' ||
        'houden; controleer je agenda.');

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
-- 3. E-mail bij het vervallen van een goedgekeurde dienst
-- ------------------------------------------------------------
-- Zelfde opzet als email_reserve_removed (0018/0022): afzender,
-- portal-URL en organisatienaam komen uit app_settings.

CREATE OR REPLACE FUNCTION public.email_shift_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  DECLARE
    v_shift  shifts%ROWTYPE;
    v_email  text;
    v_name   text;
    v_key    text;
    v_datum  text;
    v_s      app_settings%ROWTYPE;
  BEGIN
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;
    -- Wie zichzelf afmeldt hoeft geen e-mail.
    IF auth.uid() = OLD.user_id THEN RETURN OLD; END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN OLD; END IF;
    SELECT * INTO v_s FROM app_settings WHERE id = 1;

    -- Bij het verwijderen van de hele dienst (cascade) is deze rij al weg;
    -- dan gaat er bewust geen mail per medewerker uit.
    SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
    SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = OLD.user_id;
    IF v_email IS NULL THEN RETURN OLD; END IF;

    v_datum := to_char(v_shift.shift_date, 'DD-MM-YYYY');

    PERFORM net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'from',    v_s.mail_from_name || ' <' || v_s.mail_from_email || '>',
        'to',      ARRAY[v_email],
        'subject', 'Dienst vervallen – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je stond ingepland voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Deze dienst is uit jouw rooster gehaald — je wordt hier niet verwacht.</p>' ||
                   '<p>Staat de afspraak nog in je agenda? Open je rooster, dan wordt die ' ||
                   'automatisch opgeruimd.</p>' ||
                   '<p>Bekijk je rooster: <a href="' || v_s.portal_url || '">' ||
                   regexp_replace(v_s.portal_url, '^https?://', '') || '</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>' || v_s.mail_from_name || '</strong></p>'
      )
    );

    RETURN OLD;
  END;
$$;

CREATE OR REPLACE TRIGGER assignments_email_shift_removed
  AFTER DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION email_shift_removed();
