-- ============================================================
-- 0005 — ⚠️ MOET UIT DE LIVE DATABASE WORDEN GEDUMPT
-- ============================================================
-- De volgende objecten worden door de frontend gebruikt maar zijn
-- NIET met zekerheid uit de code te reconstrueren (functie-body,
-- exacte kolommen, grouping). Ze bestaan al in het live Supabase-
-- project. Dump ze daar en plak de definities hieronder, zodat de
-- database volledig reproduceerbaar is vanuit git.
--
-- Dumpen kan op twee manieren:
--   A) Supabase CLI:   supabase db dump --schema public > live_dump.sql
--   B) SQL Editor:     gebruik de queries onderaan dit bestand.
--
-- Vervang daarna de TODO-blokken hieronder met de echte definities.
-- ============================================================


-- ------------------------------------------------------------
-- TABEL: pending_students
--   Gebruikt in Studenten.tsx (insert {email, full_name}, delete by id, select *)
--   Vermoedelijke kolommen: id, email, full_name, created_at (+ evt. claimed/claimed_at)
-- TODO: plak de echte CREATE TABLE + RLS-policies hier.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RPC: claim_pending_student(...)
--   Gebruikt in Studenten.tsx — koppelt een uitnodiging aan een nieuw account.
-- TODO: plak de echte CREATE FUNCTION hier (incl. argumenten + SECURITY DEFINER).
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RPC: get_my_swaps()  ->  SETOF (zie SwapDetail in src/types/index.ts)
--   Kolommen die de frontend verwacht:
--     id, requester_id, requester_name, target_user_id, target_name,
--     requester_assignment_id, target_assignment_id, status, created_at,
--     req_shift_date, req_shift_type, req_start_time,
--     tgt_shift_date, tgt_shift_type, tgt_start_time
-- TODO: plak de echte CREATE FUNCTION hier.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RPC: get_swappable_assignments()  ->  SETOF (zie SwappableAssignment)
--   Kolommen: assignment_id, user_id, full_name,
--             shift_date, shift_type, start_time, end_time, duration_hours
-- TODO: plak de echte CREATE FUNCTION hier.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RPC: get_employee_approved_swaps()
--   Gebruikt door de admin om ruilen te tonen die wachten op admin-goedkeuring.
-- TODO: plak de echte CREATE FUNCTION hier.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RPC: execute_shift_swap(...)
--   Admin voert een goedgekeurde ruil uit (wisselt de assignments om).
-- TODO: plak de echte CREATE FUNCTION hier (incl. argumenten).
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- VIEW: shifts_with_assignments  (BIJGEWERKTE versie)
--   De versie in 0001 mist 'assignment_id' en 'status' in assigned_students,
--   terwijl ShiftWithAssignments die wél verwacht. De live view is dus
--   uitgebreid. Vervang de view uit 0001 met de live-definitie.
-- TODO: plak de echte CREATE OR REPLACE VIEW hier.
-- ------------------------------------------------------------


-- ============================================================
-- Hulpqueries om de definities uit de live-DB op te halen
-- (plak in Supabase SQL Editor):
-- ============================================================
-- Alle functie-definities in public:
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public';
--
-- View-definitie:
--   SELECT pg_get_viewdef('public.shifts_with_assignments', true);
--
-- Tabel-kolommen:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'pending_students'
--   ORDER BY ordinal_position;
