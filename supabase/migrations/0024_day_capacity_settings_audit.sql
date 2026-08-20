-- ============================================================
-- 0024 — Capaciteit per weekdag + logboek voor instellingen
-- ============================================================
-- 1. `day_capacities`: het aantal plekken per dienst per weekdag
--    (ma..zo). Vervangt het duo "standaard aantal + éénpersoons-
--    dagen" door één begrijpelijk model; de oude kolommen blijven
--    bestaan als fallback voor oudere frontend-versies.
-- 2. Wijzigingen aan app_settings verschijnen voortaan in het
--    logboek (wie, wanneer, welke velden).
-- ============================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS day_capacities int[] NOT NULL DEFAULT '{2,2,1,2,2,1,2}';

-- Neem de bestaande instellingen over in het nieuwe model.
UPDATE app_settings SET day_capacities = ARRAY(
  SELECT CASE WHEN d = ANY(single_staff_weekdays) THEN 1 ELSE default_max_students END
  FROM generate_series(1, 7) d
) WHERE id = 1;

-- ------------------------------------------------------------
-- Instellingswijzigingen in het logboek
-- ------------------------------------------------------------

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

CREATE OR REPLACE FUNCTION public.audit_app_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_changed text;
  BEGIN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
    WHERE n.value <> o.value;

    IF v_changed IS NOT NULL THEN
      PERFORM log_roster_event('instellingen', 'Instellingen gewijzigd: ' || v_changed);
    END IF;
    RETURN NEW;
  END;
$$;

CREATE OR REPLACE TRIGGER app_settings_audit
  AFTER UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION audit_app_settings();
