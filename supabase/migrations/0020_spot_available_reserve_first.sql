-- ============================================================
-- 0020 — Vrijgekomen plek: eerst de reservelijst
-- ============================================================
-- Tot nu toe kreeg élke actieve medewerker een "plek vrijgekomen"-
-- melding wanneer een goedgekeurde toewijzing werd verwijderd —
-- ook als er mensen op de reservelijst stonden. Voortaan:
--   * Staan er reserves voor de dienst, dan krijgen alleen de
--     admins een melding ("er staat iemand klaar — inroosteren?")
--     en blijft de brede melding uit. De admin plant zelf in via
--     de bestaande Inroosteren-knop, zodat de maandlimiet-check
--     en de keuzevrijheid intact blijven. Dit werkt óók als de
--     inschrijfperiode al dicht is (juist dan valt er uit).
--   * Is de reservelijst leeg, dan gaat de brede melding naar
--     alle actieve medewerkers, zoals voorheen (alleen zolang de
--     inschrijving of tweede ronde open is).
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_spot_available()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_shift    shifts%ROWTYPE;
    v_period   roster_periods%ROWTYPE;
    v_student  RECORD;
    v_admin    RECORD;
    v_spots    int;
    v_reserves int;
  BEGIN
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;

    SELECT * INTO v_shift FROM shifts WHERE id = OLD.shift_id;
    IF NOT FOUND THEN RETURN OLD; END IF;  -- dienst zelf verwijderd (cascade)
    SELECT * INTO v_period FROM roster_periods WHERE id = v_shift.period_id;

    SELECT COUNT(*) INTO v_spots
    FROM assignments WHERE shift_id = OLD.shift_id AND status = 'approved';
    IF v_spots >= v_shift.max_students THEN RETURN OLD; END IF;

    SELECT COUNT(*) INTO v_reserves
    FROM assignments WHERE shift_id = OLD.shift_id AND status = 'reserve';

    IF v_reserves > 0 THEN
      FOR v_admin IN SELECT id FROM profiles WHERE role = 'admin' AND active = true LOOP
        INSERT INTO notifications (user_id, type, title, body)
        VALUES (
          v_admin.id,
          'spot_available',
          'Plek vrijgekomen — reserve beschikbaar',
          'Er is een plek vrijgekomen op ' || to_char(v_shift.shift_date, 'DD-MM-YYYY') ||
          ' (' || v_shift.shift_type || '). Er ' ||
          CASE WHEN v_reserves = 1 THEN 'staat 1 persoon'
               ELSE 'staan ' || v_reserves || ' personen' END ||
          ' op de reservelijst — inroosteren kan via Roosterbeheer.'
        );
      END LOOP;

    ELSIF v_period.availability_open OR v_period.second_round_open THEN
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
