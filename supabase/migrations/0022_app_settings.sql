-- ============================================================
-- 0022 — Instellingen: hardcoded regels worden configuratie
-- ============================================================
-- Eerste stap richting een product dat per organisatie instelbaar
-- is. Eén settings-rij (id=1) met alles wat tot nu toe hardcoded
-- was; de bestaande ADHDMC-waarden zijn de defaults, dus gedrag
-- verandert niet totdat een beheerder iets wijzigt.
--
-- Aangesloten in deze migratie (database-kant):
--   * handle_new_user       → allowed_domain i.p.v. '@adhdmc.nl'
--   * enforce_monthly_hours_cap → monthly_cap_factor i.p.v. ×4
--   * alle e-mailfuncties   → mail_from_name/-email + portal_url
-- De frontend leest dezelfde rij (useSettings).
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id                   int PRIMARY KEY CHECK (id = 1),
  org_name             text NOT NULL DEFAULT 'ADHDMC',
  portal_url           text NOT NULL DEFAULT 'https://rooster.adhdmc.nl',
  allowed_domain       text NOT NULL DEFAULT 'adhdmc.nl',
  support_email        text NOT NULL DEFAULT 'ictservicedesk@adhdmc.nl',
  mail_from_name       text NOT NULL DEFAULT 'ADHDMC Rooster',
  mail_from_email      text NOT NULL DEFAULT 'rooster@adhdmc.nl',
  color_primary        text NOT NULL DEFAULT '#f87369',
  color_dark           text NOT NULL DEFAULT '#3c3c3b',
  -- Maandlimiet = contract_max_hours × deze factor (was hardcoded 4).
  monthly_cap_factor   numeric NOT NULL DEFAULT 4,
  -- Onbetaalde pauze voor wie meerdere dagdelen op één dag werkt.
  pause_enabled        boolean NOT NULL DEFAULT true,
  pause_start          time NOT NULL DEFAULT '12:00',
  pause_end            time NOT NULL DEFAULT '12:30',
  -- ISO-weekdagen (1=ma … 7=zo).
  premium_weekdays     int[] NOT NULL DEFAULT '{6}',      -- toeslagdagen
  premium_label        text NOT NULL DEFAULT 'zaterdag',  -- naam in exports/dashboards
  single_staff_weekdays int[] NOT NULL DEFAULT '{3,6}',   -- dagen met max 1 plek (wo + za)
  roster_weekdays      int[] NOT NULL DEFAULT '{1,2,3,4,5,6}',  -- roosterbare dagen
  default_max_students int NOT NULL DEFAULT 2,
  -- De twee dagdelen: label, standaardtijden en vroeg/laat-presets.
  shift_types          jsonb NOT NULL DEFAULT '[
    {"key":"ochtend","label":"Ochtend","start":"08:30","end":"12:30",
     "early":{"start":"08:00","end":"12:00"},"late":{"start":"08:30","end":"12:30"}},
    {"key":"middag","label":"Middag","start":"12:00","end":"17:30",
     "early":{"start":"12:00","end":"17:00"},"late":{"start":"12:30","end":"17:30"}}
  ]'::jsonb
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_select_all" ON app_settings;
-- Ook anon mag lezen: de loginpagina toont appnaam/kleuren/domein en
-- de rij bevat niets gevoeligs (geen sleutels — die staan in app_config).
CREATE POLICY "settings_select_all" ON app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "settings_update_admin" ON app_settings;
CREATE POLICY "settings_update_admin" ON app_settings FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());

-- ------------------------------------------------------------
-- 1. Domeinrestrictie uit instellingen
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_domain text;
BEGIN
  SELECT allowed_domain INTO v_domain FROM app_settings WHERE id = 1;
  v_domain := COALESCE(v_domain, 'adhdmc.nl');

  IF NEW.email IS NULL OR lower(NEW.email) NOT LIKE '%@' || lower(v_domain) THEN
    RAISE EXCEPTION 'Alleen @%-accounts hebben toegang tot deze applicatie.', v_domain;
  END IF;

  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. Maandlimiet-factor uit instellingen
-- ------------------------------------------------------------
-- Alleen de regel 'contract_max_hours * 4' wordt vervangen door
-- 'contract_max_hours * monthly_cap_factor'; de rest is identiek
-- aan 0012.

CREATE OR REPLACE FUNCTION enforce_monthly_hours_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id     UUID;
  v_new_hours     NUMERIC;
  v_existing      NUMERIC;
  v_max_monthly   NUMERIC;
  v_factor        NUMERIC;
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT s.period_id,
         CASE WHEN NEW.custom_start_time IS NOT NULL AND NEW.custom_end_time IS NOT NULL
              THEN EXTRACT(EPOCH FROM (NEW.custom_end_time - NEW.custom_start_time)) / 3600
              ELSE s.duration_hours END
    INTO v_period_id, v_new_hours
  FROM shifts s
  WHERE s.id = NEW.shift_id;

  SELECT monthly_cap_factor INTO v_factor FROM app_settings WHERE id = 1;
  v_factor := COALESCE(v_factor, 4);

  SELECT contract_max_hours * v_factor
    INTO v_max_monthly
  FROM profiles
  WHERE id = NEW.user_id;

  SELECT COALESCE(SUM(
           CASE WHEN a.custom_start_time IS NOT NULL AND a.custom_end_time IS NOT NULL
                THEN EXTRACT(EPOCH FROM (a.custom_end_time - a.custom_start_time)) / 3600
                ELSE s.duration_hours END), 0)
    INTO v_existing
  FROM assignments a
  JOIN shifts s ON s.id = a.shift_id
  WHERE a.user_id = NEW.user_id
    AND a.status = 'approved'
    AND a.id <> NEW.id
    AND s.period_id = v_period_id;

  IF v_max_monthly IS NOT NULL AND (v_existing + v_new_hours) > v_max_monthly THEN
    RAISE EXCEPTION 'Maandlimiet overschreden: % + % uur > % uur max.',
      v_existing, v_new_hours, v_max_monthly;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 3. E-mails: afzender, appnaam en portal-URL uit instellingen
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
    v_s       app_settings%ROWTYPE;
  BEGIN
    IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
      RETURN NEW;
    END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO v_s FROM app_settings WHERE id = 1;

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
        'from',    v_s.mail_from_name || ' <' || v_s.mail_from_email || '>',
        'to',      ARRAY[v_email],
        'subject', v_subject,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   v_intro ||
                   '<p>Bekijk je rooster: <a href="' || v_s.portal_url || '">' ||
                   regexp_replace(v_s.portal_url, '^https?://', '') || '</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>' || v_s.mail_from_name || '</strong></p>'
      )
    );

    RETURN NEW;
  END;
  $function$;

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
    v_s      app_settings%ROWTYPE;
  BEGIN
    IF OLD.status <> 'reserve' THEN RETURN OLD; END IF;
    IF auth.uid() = OLD.user_id THEN RETURN OLD; END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN OLD; END IF;
    SELECT * INTO v_s FROM app_settings WHERE id = 1;

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
        'subject', 'Van de reservelijst gehaald – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je stond op de reservelijst voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Je bent hiervan gehaald en hoeft met deze dienst geen rekening meer te houden.</p>' ||
                   '<p>Bekijk je rooster: <a href="' || v_s.portal_url || '">' ||
                   regexp_replace(v_s.portal_url, '^https?://', '') || '</a></p>' ||
                   '<p>Met vriendelijke groet,<br><strong>' || v_s.mail_from_name || '</strong></p>'
      )
    );

    RETURN OLD;
  END;
  $function$;

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
    v_s      app_settings%ROWTYPE;
  BEGIN
    IF NEW.status <> 'reserve' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'reserve' THEN RETURN NEW; END IF;

    SELECT value INTO v_key FROM app_config WHERE key = 'resend_api_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO v_s FROM app_settings WHERE id = 1;

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
        'from',    v_s.mail_from_name || ' <' || v_s.mail_from_email || '>',
        'to',      ARRAY[v_email],
        'subject', 'Op de reservelijst – ' || v_datum,
        'html',    '<p>Hoi ' || COALESCE(split_part(v_name, ' ', 1), '') || ',</p>' ||
                   '<p>Je staat op de reservelijst voor de <strong>' || v_shift.shift_type ||
                   'dienst</strong> op <strong>' || v_datum || '</strong> (' ||
                   left(v_shift.start_time::text, 5) || '–' || left(v_shift.end_time::text, 5) ||
                   '). Komt er een plek vrij, dan benaderen we je.</p>' ||
                   '<p>Wil je niet langer reserve staan? Afmelden kan tot 24 uur voor de ' ||
                   'start van de dienst via <a href="' || v_s.portal_url || '">' ||
                   regexp_replace(v_s.portal_url, '^https?://', '') || '</a>.</p>' ||
                   '<p>Met vriendelijke groet,<br><strong>' || v_s.mail_from_name || '</strong></p>'
      )
    );

    RETURN NEW;
  END;
  $function$;
