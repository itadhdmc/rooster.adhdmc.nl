-- ============================================================
-- Nabetaling: toeslaguren en ziekteuren per loonperiode
-- ============================================================
-- Uitsplitsing voor de loonadministratie bij de nabetaling over de
-- periodes waarin de oude urenexport de eerste dagen van de loonperiode
-- oversloeg. Leest alleen; wijzigt niets. Draait in de SQL-editor.
--
-- Twee losse queries. Draai ze apart (selecteer een blok en voer uit):
--   1. Totalen per medewerker per loonperiode — dit is de uitsplitsing.
--   2. Detail per dienstdag — de onderbouwing onder die totalen.
--
-- Rekenregels zijn gelijk aan de urenexport in de app
-- (src/utils/paidHours.ts), zie uren-per-medewerker.sql.
--
-- Twee dingen die hier anders zijn dan in uren-per-medewerker.sql:
--   * De loonperiode (21e t/m de 20e) wordt zelf afgeleid, dus je kunt
--     meerdere periodes in één keer opvragen: zet "van" op de 21e van de
--     eerste periode en "tot" op de 20e van de laatste.
--   * "Na te betalen" = de dagen vanaf de 21e. Dat is precies het stuk
--     dat de oude export liet vallen: die filterde op de kalendermaand
--     van de einddatum, dus de staart van de vorige maand verdween.
--   * Ziekteuren staan er apart bij, ook voor iemand die in de periode
--     alléén ziek gemeld stond en dus geen gewerkte dagen heeft.
--     Ze worden nergens in de verloonde uren meegeteld: wat ervan
--     uitbetaald wordt, is een beslissing van de loonadministratie
--     (cao GGZ: eerste zes maanden 100% van het laatstverdiende loon).
--
-- Ziekteuren zijn de uren waarvoor iemand ingeroosterd stond; er gaat
-- geen pauze of middagoverlap vanaf, want er is niet gewerkt.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Totalen per medewerker per loonperiode
-- ------------------------------------------------------------

WITH bereik AS (
  SELECT DATE '2026-08-21' AS van,          -- 21e: begin van de eerste loonperiode
         DATE '2026-09-20' AS tot,          -- 20e: eind van de laatste loonperiode
         21                 AS periode_start_dag
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
         TO_CHAR(DATE_TRUNC('month', s.shift_date)
                 + CASE WHEN EXTRACT(DAY FROM s.shift_date) >= b.periode_start_dag
                        THEN INTERVAL '1 month' ELSE INTERVAL '0 month' END,
                 'YYYY-MM')                                          AS loonperiode,
         (EXTRACT(DAY FROM s.shift_date) >= b.periode_start_dag)      AS gemist,
         (EXTRACT(ISODOW FROM s.shift_date)::int = ANY (c.premium_weekdays)) AS toeslagdag,
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
  CROSS JOIN cfg c
  WHERE a.status = 'approved'
    AND s.shift_date BETWEEN b.van AND b.tot
),
gewerkt AS (
  SELECT * FROM regels WHERE attendance = 'gewerkt'
),
dag AS (
  SELECT user_id, loonperiode, shift_date, gemist, toeslagdag,
         COUNT(*) AS blokken, SUM(uren) AS bruto
  FROM gewerkt GROUP BY user_id, loonperiode, shift_date, gemist, toeslagdag
),
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
  SELECT d.user_id, d.loonperiode, d.shift_date, d.gemist, d.toeslagdag,
         d.bruto
           - COALESCE(o.uren, 0)
           - CASE WHEN d.blokken >= 2 AND c.pause_enabled THEN c.pause_hours ELSE 0 END AS verloond
  FROM dag d
  CROSS JOIN cfg c
  LEFT JOIN overlap o ON o.user_id = d.user_id AND o.shift_date = d.shift_date
),
werk AS (
  SELECT user_id, loonperiode,
         SUM(verloond) FILTER (WHERE gemist AND NOT toeslagdag) AS na_doordeweeks,
         SUM(verloond) FILTER (WHERE gemist AND toeslagdag)     AS na_toeslagdag,
         SUM(verloond) FILTER (WHERE NOT gemist)                AS al_uitbetaald
  FROM dagtotaal GROUP BY user_id, loonperiode
),
ziekte AS (
  SELECT user_id, loonperiode,
         SUM(uren) FILTER (WHERE NOT toeslagdag) AS ziek_doordeweeks,
         SUM(uren) FILTER (WHERE toeslagdag)     AS ziek_toeslagdag
  FROM regels WHERE attendance = 'ziek' GROUP BY user_id, loonperiode
)
SELECT loonperiode,
       COALESCE(p.full_name, p.email)                    AS naam,
       p.email,
       -- Uren die de oude export overhield: die zijn al verloond.
       ROUND(COALESCE(w.al_uitbetaald, 0), 2)            AS reeds_uitbetaalde_uren,
       -- Alsnog te verlonen: de dagen vanaf de 21e, gesplitst omdat op
       -- toeslagdagen een andere beloning staat.
       ROUND(COALESCE(w.na_doordeweeks, 0), 2)           AS na_te_betalen_doordeweeks,
       ROUND(COALESCE(w.na_toeslagdag, 0), 2)            AS na_te_betalen_toeslagdag,
       ROUND(COALESCE(w.na_doordeweeks, 0)
           + COALESCE(w.na_toeslagdag, 0), 2)            AS na_te_betalen_totaal,
       -- Ziekteuren: apart, niet in de bedragen hierboven verwerkt.
       ROUND(COALESCE(z.ziek_doordeweeks, 0), 2)         AS ziekteuren_doordeweeks,
       ROUND(COALESCE(z.ziek_toeslagdag, 0), 2)          AS ziekteuren_toeslagdag,
       ROUND(COALESCE(z.ziek_doordeweeks, 0)
           + COALESCE(z.ziek_toeslagdag, 0), 2)          AS ziekteuren_totaal
FROM werk w
FULL OUTER JOIN ziekte z USING (user_id, loonperiode)
JOIN profiles p ON p.id = user_id
WHERE COALESCE(w.na_doordeweeks, 0) + COALESCE(w.na_toeslagdag, 0)
    + COALESCE(z.ziek_doordeweeks, 0) + COALESCE(z.ziek_toeslagdag, 0) > 0
ORDER BY loonperiode, naam;


-- ------------------------------------------------------------
-- 2. Detail per dienstdag — onderbouwing onder de totalen
-- ------------------------------------------------------------
-- Elke regel die in de nabetaling meetelt, met datum en dagnaam, zodat
-- de loonadministratie het bedrag kan narekenen. Eén medewerker nodig?
-- Haal het commentaarteken weg bij de regel met full_name ILIKE.

WITH bereik AS (
  SELECT DATE '2026-08-21' AS van,
         DATE '2026-09-20' AS tot,
         21                 AS periode_start_dag
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
         TO_CHAR(DATE_TRUNC('month', s.shift_date)
                 + CASE WHEN EXTRACT(DAY FROM s.shift_date) >= b.periode_start_dag
                        THEN INTERVAL '1 month' ELSE INTERVAL '0 month' END,
                 'YYYY-MM')                                          AS loonperiode,
         (EXTRACT(DAY FROM s.shift_date) >= b.periode_start_dag)      AS gemist,
         (EXTRACT(ISODOW FROM s.shift_date)::int = ANY (c.premium_weekdays)) AS toeslagdag,
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
  CROSS JOIN cfg c
  WHERE a.status = 'approved'
    AND s.shift_date BETWEEN b.van AND b.tot
),
gewerkt AS (
  SELECT * FROM regels WHERE attendance = 'gewerkt'
),
dag AS (
  SELECT user_id, loonperiode, shift_date, gemist, toeslagdag,
         COUNT(*) AS blokken, SUM(uren) AS bruto
  FROM gewerkt GROUP BY user_id, loonperiode, shift_date, gemist, toeslagdag
),
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
  SELECT d.user_id, d.loonperiode, d.shift_date, d.gemist, d.toeslagdag,
         d.blokken,
         CASE WHEN d.blokken >= 2 AND c.pause_enabled THEN c.pause_hours ELSE 0 END AS pauze,
         COALESCE(o.uren, 0) AS overlap_uren,
         d.bruto
           - COALESCE(o.uren, 0)
           - CASE WHEN d.blokken >= 2 AND c.pause_enabled THEN c.pause_hours ELSE 0 END AS verloond
  FROM dag d
  CROSS JOIN cfg c
  LEFT JOIN overlap o ON o.user_id = d.user_id AND o.shift_date = d.shift_date
),
detail AS (
  SELECT user_id, loonperiode, shift_date, toeslagdag,
         CASE WHEN toeslagdag THEN 'na te betalen — toeslagdag'
                              ELSE 'na te betalen — doordeweeks' END AS soort,
         blokken AS dagdelen,
         ROUND(pauze, 2)        AS pauze_uren_onbetaald,
         ROUND(overlap_uren, 2) AS overlap_uren,
         ROUND(verloond, 2)     AS uren
  FROM dagtotaal WHERE gemist
  UNION ALL
  SELECT user_id, loonperiode, shift_date, toeslagdag,
         CASE WHEN toeslagdag THEN 'ziekteuren — toeslagdag'
                              ELSE 'ziekteuren — doordeweeks' END,
         COUNT(*), 0.00, 0.00, ROUND(SUM(uren), 2)
  FROM regels WHERE attendance = 'ziek'
  GROUP BY user_id, loonperiode, shift_date, toeslagdag
)
SELECT d.loonperiode,
       COALESCE(p.full_name, p.email) AS naam,
       d.shift_date                   AS datum,
       (ARRAY['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'])
         [EXTRACT(ISODOW FROM d.shift_date)::int] AS dag,
       d.soort,
       d.dagdelen,
       d.pauze_uren_onbetaald,
       d.overlap_uren,
       d.uren
FROM detail d
JOIN profiles p ON p.id = d.user_id
-- AND p.full_name ILIKE '%Manal%'
ORDER BY d.loonperiode, naam, d.shift_date, d.soort;
