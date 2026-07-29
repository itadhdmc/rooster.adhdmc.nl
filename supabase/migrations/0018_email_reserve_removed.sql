-- ============================================================
-- 0018 — E-mail bij verwijdering van de reservelijst
-- ============================================================
-- Feedback uit de praktijk (test 0017): wie door de admin van de
-- reservelijst wordt gehaald kreeg wel een in-app melding, maar
-- geen e-mail — je moest dus alsnog inloggen om het te zien.
-- Voortaan gaat er ook een e-mail uit. Zelf afmelden blijft
-- zonder e-mail (dat deed je immers zelf), net als het verdwijnen
-- van de dienst zelf (cascade-delete).
-- ============================================================

CREATE OR REPLACE FUNCTION public.email_reserve_removed()
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
    IF OLD.status <> 'reserve' THEN RETURN OLD; END IF;
    -- Wie zichzelf afmeldt hoeft geen e-mail.
    IF auth.uid() = OLD.user_id THEN RETURN OLD; END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN OLD; END IF;

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
        'from',    'ADHDMC Rooster <rooster@adhdmc.nl>',
        'to',      ARRAY[v_email],
        'subject', 'Van de reservelijst gehaald – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je stond op de reservelijst voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Je bent hiervan gehaald en hoeft met deze dienst geen rekening meer te houden.</p>' ||
                   '<p>Bekijk je rooster: <a href="https://rooster.adhdmc.nl">rooster.adhdmc.nl</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>ADHDMC Roostersysteem</strong></p>'
      )
    );

    RETURN OLD;
  END;
  $function$;

CREATE OR REPLACE TRIGGER assignments_email_reserve_removed
  AFTER DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION email_reserve_removed();
