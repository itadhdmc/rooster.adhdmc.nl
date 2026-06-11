-- ============================================================
-- 0011 — Security hardening
-- ============================================================
-- Dicht drie gaten die vanuit de browser-console (Supabase REST API)
-- te misbruiken waren. Deze migratie wijzigt ALLEEN policies,
-- triggers en functies — er wordt geen enkele rij data aangepast.
-- Veilig om op de live database uit te voeren.
--
--   1. KRITIEK: een student kon zijn eigen profiel updaten naar
--      role='admin' (profiles_update_own beperkt geen kolommen).
--   2. KRITIEK: elk willekeurig Google-account kon inloggen; de
--      domeincheck (@adhdmc.nl) zat alleen in de frontend. De
--      'hd'-parameter bij Google is slechts een hint, geen filter.
--   3. HOOG: de aanvrager of doel-collega van een ruilverzoek kon
--      via een directe UPDATE de status of zelfs de gekoppelde
--      diensten/personen van het verzoek manipuleren.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Profielvelden beschermen tegen zelf-escalatie
-- ------------------------------------------------------------
-- Niet-admins mogen alleen hun eigen full_name wijzigen. role,
-- contracturen, active en email zijn voorbehouden aan admins.
-- SECURITY DEFINER zodat de admin-check niet door RLS wordt geblokkeerd.

CREATE OR REPLACE FUNCTION protect_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- auth.uid() IS NULL = service role (edge functions e.d.): toestaan.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.contract_min_hours IS DISTINCT FROM OLD.contract_min_hours
       OR NEW.contract_max_hours IS DISTINCT FROM OLD.contract_max_hours
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Geen rechten om rol, contracturen, status of e-mail te wijzigen.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_protect_columns ON profiles;

CREATE TRIGGER profiles_protect_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_columns();

-- Nieuwe profielen mogen nooit direct als admin worden aangemaakt.
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id AND role = 'student');


-- ------------------------------------------------------------
-- 2. Domeinbeperking server-side afdwingen
-- ------------------------------------------------------------
-- Voorheen kreeg élk Google-account een sessie + profiel; alleen de
-- frontend verstopte daarna de UI. Met sessie kon zo'n account via de
-- REST API alsnog het rooster, alle namen/e-mails (via de views) en
-- meer lezen. Door hier te weigeren mislukt de registratie al bij
-- Supabase Auth zelf.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL OR lower(NEW.email) NOT LIKE '%@adhdmc.nl' THEN
    RAISE EXCEPTION 'Alleen @adhdmc.nl accounts hebben toegang tot deze applicatie.';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 3. Ruilverzoeken: alleen geldige statusovergangen
-- ------------------------------------------------------------
-- De doel-collega mag een openstaand (pending) verzoek alleen
-- goedkeuren of afwijzen. De aanvrager annuleert via DELETE (bestond
-- al). Niemand behalve de RPC/admin-flow zet 'admin_approved'.

DROP POLICY IF EXISTS "swaps_update_target" ON shift_swaps;

CREATE POLICY "swaps_update_target" ON shift_swaps FOR UPDATE
  USING (target_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (target_user_id = auth.uid() AND status IN ('employee_approved', 'rejected'));

-- De kernvelden van een ruilverzoek (wie, welke diensten) mogen na
-- aanmaken nooit meer wijzigen — alleen de status. Geldt ook voor
-- admins; een gewijzigde ruil hoort een nieuw verzoek te zijn.
CREATE OR REPLACE FUNCTION protect_swap_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.requester_assignment_id IS DISTINCT FROM OLD.requester_assignment_id
     OR NEW.target_assignment_id IS DISTINCT FROM OLD.target_assignment_id THEN
    RAISE EXCEPTION 'Alleen de status van een ruilverzoek mag wijzigen.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shift_swaps_protect_columns ON shift_swaps;

CREATE TRIGGER shift_swaps_protect_columns
  BEFORE UPDATE ON shift_swaps
  FOR EACH ROW
  EXECUTE FUNCTION protect_swap_columns();


-- ------------------------------------------------------------
-- 4. Ongebruikte view niet langer RLS laten omzeilen
-- ------------------------------------------------------------
-- Views draaien standaard met de rechten van de eigenaar (postgres)
-- en omzeilen dus RLS. student_hours_per_month toont ieders uren en
-- contracturen aan elke ingelogde gebruiker, maar wordt door de app
-- niet gebruikt. Met security_invoker geldt voortaan gewoon RLS
-- (admins zien alles, studenten alleen zichzelf).
--
-- NB: shifts_with_assignments blijft bewust een definer-view: de
-- inschrijfpagina van studenten heeft de bezetting en namen van
-- collega's nodig.
--
-- De view blijkt in de live database niet (meer) te bestaan, daarom
-- alleen aanpassen als hij er is.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'student_hours_per_month'
  ) THEN
    EXECUTE 'ALTER VIEW student_hours_per_month SET (security_invoker = true)';
  END IF;
END $$;
