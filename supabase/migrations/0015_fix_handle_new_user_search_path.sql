-- ============================================================
-- 0015 — handle_new_user() crasht bij nieuwe gebruikers
-- ============================================================
-- Live-symptoom (Auth-log, 18-06-2026):
--   "500: Database error saving new user"
--   relation "profiles" does not exist (SQLSTATE 42P01) op /callback
--
-- Oorzaak: de trigger handle_new_user() (uit 0011) is SECURITY DEFINER
-- maar heeft GEEN expliciet search_path en verwijst naar `profiles`
-- zonder schema. Bij het aanmaken van een nieuwe auth-gebruiker draait
-- de trigger als supabase_auth_admin, met een zoekpad dat `public` niet
-- bevat → `profiles` wordt niet gevonden → de hele signup-transactie
-- draait terug. Gevolg: ELKE nieuwe medewerker kan niet inloggen
-- (bestaande gebruikers hebben hun auth.users-rij al, dus bij hen vuurt
-- de INSERT-trigger niet — vandaar dat alleen nieuwe accounts vastlopen).
--
-- Fix: search_path vastzetten op public én de tabel volledig
-- kwalificeren (public.profiles). De @adhdmc.nl-domeincheck uit 0011
-- blijft ongewijzigd behouden. Geen datawijziging — alleen de functie.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR lower(NEW.email) NOT LIKE '%@adhdmc.nl' THEN
    RAISE EXCEPTION 'Alleen @adhdmc.nl accounts hebben toegang tot deze applicatie.';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- De trigger zelf is onveranderd, maar voor de zekerheid herbevestigen
-- (idempotent — verwijst naar dezelfde functie).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
