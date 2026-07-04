-- ============================================================
-- 0016 — Security hardening, ronde 2
-- ============================================================
-- Volledige audit van policies, views en functies (03-07-2026).
-- Wijzigt ALLEEN rechten en functie-instellingen — geen enkele rij
-- data, en geen gedragsverandering voor ingelogde gebruikers.
--
-- Bevindingen (hieronder gedicht):
--   1. HOOG: de view shifts_with_assignments draait met owner-rechten
--      (bewust, zie 0011) maar was óók leesbaar voor de anon-rol. De
--      anon-key zit publiek in de app-bundel, dus iedereen op internet
--      kon namen/e-mails/statussen van alle medewerkers opvragen.
--   2. MIDDEL: get_employee_approved_swaps (SECURITY DEFINER) had geen
--      enkele auth-check — ook anoniem aan te roepen, met namen en
--      diensten van ruilverzoeken als resultaat. Alleen het
--      admin-dashboard gebruikt deze RPC.
--   3. MIDDEL: zes SECURITY DEFINER-functies hadden geen vast
--      search_path — dezelfde bugklasse die in 0015 de login van
--      nieuwe gebruikers brak, en daarnaast een bekend
--      schema-shadowing-risico.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Views niet langer leesbaar voor niet-ingelogde bezoekers
-- ------------------------------------------------------------
-- Ingelogde medewerkers (rol authenticated) behouden toegang; de
-- app bevraagt deze view alleen na login.

REVOKE SELECT ON shifts_with_assignments FROM anon;

-- student_hours_per_month bestaat mogelijk niet (zie 0011); zo wel,
-- dan is hij al security_invoker maar hoort anon er evenmin bij.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'student_hours_per_month'
  ) THEN
    EXECUTE 'REVOKE SELECT ON student_hours_per_month FROM anon';
  END IF;
END $$;


-- ------------------------------------------------------------
-- 2. get_employee_approved_swaps: alleen admins
-- ------------------------------------------------------------
-- Niet-admins krijgen een lege lijst (geen exception, zodat een
-- eventuele aanroep de app niet laat crashen).

CREATE OR REPLACE FUNCTION public.get_employee_approved_swaps()
 RETURNS TABLE(id uuid, requester_name text, target_name text, requester_assignment_id uuid, target_assignment_id uuid, req_shift_date date, req_shift_type text, tgt_shift_date date, tgt_shift_type text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
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
      AND is_admin()
    ORDER BY ss.created_at;
  $function$;


-- ------------------------------------------------------------
-- 3. search_path vastzetten op de overige SECURITY DEFINER-functies
-- ------------------------------------------------------------
-- ALTER (i.p.v. CREATE OR REPLACE) zodat de live functie-bodies
-- ongemoeid blijven; alleen de instelling wordt toegevoegd. De
-- notify-/email-functies, is_admin, execute_shift_swap en
-- handle_new_user hebben dit al (0005/0013/0015).

ALTER FUNCTION public.claim_pending_student() SET search_path = public;
ALTER FUNCTION public.get_swappable_assignments() SET search_path = public;
ALTER FUNCTION public.get_my_swaps() SET search_path = public;
ALTER FUNCTION public.set_calendar_event_id(uuid, text) SET search_path = public;
ALTER FUNCTION public.protect_profile_columns() SET search_path = public;
