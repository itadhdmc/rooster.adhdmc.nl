-- ============================================================
-- 0007 — Harde maandlimiet op goedgekeurde uren
-- ============================================================
-- Een student mag per maand (= roosterperiode) niet méér dan de
-- contractuele maximum-uren goedgekeurd krijgen.
--   maand-max = contract_max_hours * 4   (4-16 uur/week -> 16-64 uur/maand)
--
-- Alleen GOEDGEKEURDE toewijzingen tellen mee, en de controle bijt
-- bij het goedkeuren (INSERT/UPDATE naar status='approved'). Dit
-- wordt server-side afgedwongen, dus niet te omzeilen vanuit de UI.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_monthly_hours_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_period_id     UUID;
  v_new_hours     NUMERIC;
  v_existing      NUMERIC;
  v_max_monthly   NUMERIC;
BEGIN
  -- Alleen relevant wanneer de toewijzing goedgekeurd is/wordt.
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT s.period_id, s.duration_hours
    INTO v_period_id, v_new_hours
  FROM shifts s
  WHERE s.id = NEW.shift_id;

  SELECT contract_max_hours * 4
    INTO v_max_monthly
  FROM profiles
  WHERE id = NEW.user_id;

  -- Reeds goedgekeurde uren van deze student in dezelfde periode,
  -- exclusief de huidige toewijzing.
  SELECT COALESCE(SUM(s.duration_hours), 0)
    INTO v_existing
  FROM assignments a
  JOIN shifts s ON s.id = a.shift_id
  WHERE a.user_id = NEW.user_id
    AND a.status = 'approved'
    AND s.period_id = v_period_id
    AND a.id <> NEW.id;

  IF v_existing + v_new_hours > v_max_monthly THEN
    RAISE EXCEPTION
      'Maandlimiet overschreden: dit zou % uur worden, maar het maximum is % uur deze maand.',
      v_existing + v_new_hours, v_max_monthly
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignments_monthly_cap ON assignments;

CREATE TRIGGER assignments_monthly_cap
  BEFORE INSERT OR UPDATE OF status ON assignments
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION enforce_monthly_hours_cap();
