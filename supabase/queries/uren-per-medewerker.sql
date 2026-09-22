-- ============================================================
-- Verloonde uren per medewerker over een vrij datumbereik
-- ============================================================
-- Controlequery voor de loonadministratie. Leest alleen; wijzigt niets.
-- Draait in de SQL-editor van Supabase.
--
-- Zelfde rekenregels als de urenexport in de app (src/utils/paidHours.ts):
--   * afwijkende werktijden (custom_start/end) gaan vóór de duur van de dienst
--   * bij 2+ gewerkte dagdelen op één dag: de dubbele overlap eraf
--   * bij 2+ gewerkte dagdelen op één dag: de onbetaalde pauze eraf
--   * ziek/afwezig telt niet mee in de verloonde uren
--
-- Pas alleen het bereik in "bereik" aan. De kolom "gemist_door_oude_export"
-- laat zien hoeveel uren de oude export oversloeg: alles vóór de 1e van de
-- eindmaand viel buiten de gekozen roosterperiode en verdween stilzwijgend.
-- ============================================================

WITH bereik AS (
  SELECT DATE '2026-08-21' AS van,
         DATE '2026-09-20' AS tot
),
cfg AS (
  SELECT pause_enabled,
         (EXTRACT(EPOCH FROM (pause_end - pause_start)) / 3600.0)::numeric AS pause_hours,
         premium_weekdays
  FROM app_settings WHERE id = 1
),
regels AS (
  SELECT a.id,
         a.user_id,
         s.shift_date,
         COALESCE(a.attendance, 'gewerkt') AS attendance,
         COALESCE(a.custom_start_time, s.start_time) AS van,
         COALESCE(a.custom_end_time,   s.end_time)   AS tot,
         ROUND(
           CASE WHEN a.custom_start_time IS NOT NULL AND a.custom_end_time IS NOT NULL
                THEN (EXTRACT(EPOCH FROM (a.custom_end_time - a.custom_start_time)) / 3600.0)::numeric
                ELSE s.duration_hours
           END, 2) AS uren
  FROM assignments a
  JOIN shifts s ON s.id = a.shift_id
  CROSS JOIN bereik b
  WHERE a.status = 'approved'
    AND s.shift_date BETWEEN b.van AND b.tot
),
gewerkt AS (
  SELECT * FROM regels WHERE attendance = 'gewerkt'
),
dag AS (
  SELECT user_id, shift_date, COUNT(*) AS blokken, SUM(uren) AS bruto
  FROM gewerkt GROUP BY user_id, shift_date
),
-- Elk paar dagdelen van dezelfde medewerker op dezelfde dag één keer:
-- de tijd die dubbel geteld zou worden (standaard 12:00-12:30).
overlap AS (
  SELECT g1.user_id, g1.shift_date,
         SUM(ROUND((EXTRACT(EPOCH FROM (LEAST(g1.tot, g2.tot) - GREATEST(g1.van, g2.van))) / 3600.0)::numeric, 2)) AS uren
  FROM gewerkt g1
  JOIN gewerkt g2
    ON g2.user_id = g1.user_id
   AND g2.shift_date = g1.shift_date
   AND g2.id > g1.id
  WHERE LEAST(g1.tot, g2.tot) > GREATEST(g1.van, g2.van)
  GROUP BY g1.user_id, g1.shift_date
),
dagtotaal AS (
  SELECT d.user_id,
         d.shift_date,
         CASE WHEN d.blokken >= 2 AND c.pause_enabled THEN c.pause_hours ELSE 0 END AS pauze,
         d.bruto
           - COALESCE(o.uren, 0)
           - CASE WHEN d.blokken >= 2 AND c.pause_enabled THEN c.pause_hours ELSE 0 END AS verloond,
         (EXTRACT(ISODOW FROM d.shift_date)::int = ANY (c.premium_weekdays)) AS toeslagdag
  FROM dag d
  CROSS JOIN cfg c
  LEFT JOIN overlap o ON o.user_id = d.user_id AND o.shift_date = d.shift_date
),
ziek AS (
  SELECT user_id,
         SUM(uren) FILTER (WHERE attendance = 'ziek')    AS ziek_uren,
         SUM(uren) FILTER (WHERE attendance = 'afwezig') AS afwezig_uren
  FROM regels GROUP BY user_id
),
-- Per medewerker optellen. Apart van "ziek", want wie in het bereik
-- alleen ziek of afwezig stond heeft geen gewerkte dagen en zou bij een
-- gewone join uit de lijst vallen — juist die regel moet zichtbaar zijn.
werk AS (
  SELECT user_id,
         COUNT(*)                                                      AS gewerkte_dagen,
         SUM(verloond) FILTER (WHERE NOT toeslagdag)                   AS uren_doordeweeks,
         SUM(verloond) FILTER (WHERE toeslagdag)                       AS uren_toeslagdag,
         SUM(pauze)                                                    AS pauze_uren,
         SUM(verloond)                                                 AS totaal_uren,
         -- Wat de oude, kapotte export wél gaf: alleen de dagen vanaf
         -- de 1e van de eindmaand.
         SUM(verloond) FILTER (
           WHERE shift_date >= DATE_TRUNC('month', (SELECT tot FROM bereik))::date) AS oude_export_uren,
         -- Het verschil: de uren die niet verloond zijn. Gesplitst, want op
         -- de toeslagdagen zit een andere beloning dan op doordeweekse dagen.
         SUM(verloond) FILTER (
           WHERE shift_date < DATE_TRUNC('month', (SELECT tot FROM bereik))::date) AS gemist_uren,
         SUM(verloond) FILTER (
           WHERE shift_date < DATE_TRUNC('month', (SELECT tot FROM bereik))::date
             AND NOT toeslagdag)                                       AS gemist_doordeweeks,
         SUM(verloond) FILTER (
           WHERE shift_date < DATE_TRUNC('month', (SELECT tot FROM bereik))::date
             AND toeslagdag)                                           AS gemist_toeslagdag
  FROM dagtotaal GROUP BY user_id
)
SELECT COALESCE(p.full_name, p.email)                 AS naam,
       p.email,
       COALESCE(w.gewerkte_dagen, 0)                  AS gewerkte_dagen,
       ROUND(COALESCE(w.uren_doordeweeks, 0), 2)      AS uren_doordeweeks,
       ROUND(COALESCE(w.uren_toeslagdag, 0), 2)       AS uren_toeslagdag,
       ROUND(COALESCE(w.pauze_uren, 0), 2)            AS pauze_uren_onbetaald,
       ROUND(COALESCE(w.totaal_uren, 0), 2)           AS totaal_verloonde_uren,
       ROUND(COALESCE(z.ziek_uren, 0), 2)             AS ziek_uren,
       ROUND(COALESCE(z.afwezig_uren, 0), 2)          AS afwezig_uren,
       ROUND(COALESCE(w.oude_export_uren, 0), 2)      AS oude_export_uren,
       ROUND(COALESCE(w.gemist_uren, 0), 2)           AS gemist_door_oude_export,
       ROUND(COALESCE(w.gemist_doordeweeks, 0), 2)    AS gemist_doordeweeks,
       ROUND(COALESCE(w.gemist_toeslagdag, 0), 2)     AS gemist_toeslagdag
FROM werk w
FULL OUTER JOIN ziek z USING (user_id)
JOIN profiles p ON p.id = user_id
ORDER BY naam;
