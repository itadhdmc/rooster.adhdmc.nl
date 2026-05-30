-- ============================================================
-- 0003 — In-app notificaties (Inbox)
-- ============================================================
-- Gereconstrueerd uit src/types/index.ts (Notification) en het
-- gebruik in Inbox.tsx en Layout.tsx (realtime INSERT-subscription).
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'shift_approved', 'shift_rejected', 'admin_pending',
    'spot_available', 'swap_request', 'swap_approved', 'swap_rejected'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Gebruikers zien, markeren-als-gelezen en verwijderen alleen hun eigen meldingen.
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- Inserts gebeuren server-side (triggers / RPC's met SECURITY DEFINER),
-- daarom geen brede INSERT-policy voor gewone gebruikers.
