-- ============================================================
-- 0012 — Afwijkende werktijden per persoon per dienst
-- ============================================================
-- De standaardtijden van een dienst (bijv. 12:00–17:30) blijven
-- gelden, maar de admin kan per ingeroosterde medewerker afwijkende
-- tijden vastleggen (bijv. iemand die die dag 13:00–17:30 werkt).
--
-- NULL = de standaardtijden van de dienst. Alleen kolommen erbij en
-- bestaande functies bijgewerkt — geen bestaande data gewijzigd.
-- ============================================================

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS custom_start_time TIME,
  ADD COLUMN IF NOT EXISTS custom_end_time TIME;

-- Beide ingevuld of beide leeg, en eind na start.
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_custom_times_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_custom_times_check CHECK (
  (custom_start_time IS NULL AND custom_end_time IS NULL)
  OR (custom_start_time IS NOT NULL AND custom_end_time IS NOT NULL
      AND custom_end_time > custom_start_time)
);

-- Studenten schrijven zichzelf in zónder afwijkende tijden; alleen
-- admins (assignments_write_admin / _insert_admin) zetten die.
DROP POLICY IF EXISTS "assignments_insert_own_pending" ON assignments;
CREATE POLICY "assignments_insert_own_pending" ON assignments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND custom_start_time IS NULL
    AND custom_end_time IS NULL
  );

-- ------------------------------------------------------------
-- Maandlimiet: reken met de effectieve uren (afwijkende tijden
-- tellen mee in plaats van de standaardduur van de dienst).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_monthly_hours_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_period_id     UUID;
  v_new_hours     NUMERIC;
  v_existing      NUMERIC;
  v_max_monthly   NUMERIC;
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

  SELECT contract_max_hours * 4
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

-- Ook controleren wanneer de admin de tijden van een al goedgekeurde
-- dienst aanpast.
DROP TRIGGER IF EXISTS assignments_monthly_cap ON assignments;

CREATE TRIGGER assignments_monthly_cap
  BEFORE INSERT OR UPDATE OF status, custom_start_time, custom_end_time ON assignments
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION enforce_monthly_hours_cap();
