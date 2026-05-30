-- ============================================================
-- 0006 — Google refresh-tokens (voor server-side agenda-sync)
-- ============================================================
-- De Google access-token uit de login verloopt na ~1 uur en kan
-- niet ververst worden zonder de gebruiker. Door de refresh-token
-- op te slaan kan een Edge Function (service role) server-side een
-- nieuwe access-token ophalen en de agenda bijwerken — ook als de
-- gebruiker de app niet open heeft.
--
-- Vereist dat de OAuth-login om offline toegang vraagt
-- (access_type=offline, prompt=consent) — dat doet auth.ts al.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

-- De gebruiker mag alleen zijn eigen token opslaan/bijwerken.
-- Bewust GEEN select-policy: het token wordt nooit terug naar de
-- client gestuurd; alleen de Edge Function leest het via de service role.
CREATE POLICY "google_tokens_insert_own" ON google_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "google_tokens_update_own" ON google_tokens FOR UPDATE
  USING (user_id = auth.uid());
