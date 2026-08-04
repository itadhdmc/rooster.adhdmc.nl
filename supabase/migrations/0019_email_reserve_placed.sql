-- ============================================================
-- 0019 — E-mail bij plaatsing op de reservelijst
-- ============================================================
-- Sluitstuk na 0017/0018: elke reservelijst-overgang mailt nu.
--   * op de lijst gezet     → deze migratie
--   * ingepland vanaf lijst → email_shift_approved (0017)
--   * van de lijst gehaald  → email_reserve_removed (0018)
-- Plaatsing gebeurt op twee manieren: een pending-aanvraag die
-- naar 'reserve' gaat (UPDATE) én direct toevoegen door de admin
-- (INSERT met status 'reserve') — de trigger dekt beide.
-- ============================================================

CREATE OR REPLACE FUNCTION public.email_reserve_placed()
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
    IF NEW.status <> 'reserve' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'reserve' THEN RETURN NEW; END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
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
        'subject', 'Op de reservelijst – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je staat op de reservelijst voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Komt er een plek vrij, dan benaderen we je.</p>' ||
                   '<p>Wil je niet langer reserve staan? Afmelden kan tot 24 uur voor de ' ||
                   'start van de dienst via <a href="https://rooster.adhdmc.nl">rooster.adhdmc.nl</a>.</p>' ||
                   '<p>Met vriendelijke groet,<br><strong>ADHDMC Roostersysteem</strong></p>'
      )
    );

    RETURN NEW;
  END;
  $function$;

CREATE OR REPLACE TRIGGER assignments_email_reserve_placed
  AFTER INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION email_reserve_placed();
