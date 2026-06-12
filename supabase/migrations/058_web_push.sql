-- Web Push for the PWA.
--
-- Browser push subscriptions are stored per user/device. A trigger on
-- notifications INSERT fires a pg_net HTTP call to the CRM's
-- /api/push/dispatch endpoint, which sends the actual Web Push messages —
-- so every existing notifications.insert() call site (client and server)
-- gets push for free, with no code changes.
--
-- ⚠ ONE-TIME SETUP after applying (SQL editor, values from the server .env):
--   INSERT INTO app_settings (key, value) VALUES
--     ('push_dispatch_url',    'https://crm.noveliotech.com/api/push/dispatch'),
--     ('push_dispatch_secret', '<CRON_SECRET>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Until those rows exist the trigger is a silent no-op.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Push subscriptions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,        -- push service URL, unique per device
  p256dh     TEXT NOT NULL,               -- encryption keys from PushSubscription
  auth       TEXT NOT NULL,
  user_agent TEXT,                        -- helps users recognise their devices
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── App settings (trigger config; no policies → service role only) ─────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ── Trigger: notifications INSERT → POST /api/push/dispatch ────────────────
CREATE OR REPLACE FUNCTION dispatch_push_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.app_settings WHERE key = 'push_dispatch_url';
  SELECT value INTO v_secret FROM public.app_settings WHERE key = 'push_dispatch_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;  -- push not configured yet
  END IF;

  -- net.http_post queues the request asynchronously; the insert never waits
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id',         NEW.user_id,
      'title',           NEW.title,
      'message',         NEW.message,
      'type',            NEW.type,
      'link',            NEW.link
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- push must never block a notification insert
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notifications_push_dispatch ON notifications;
CREATE TRIGGER notifications_push_dispatch
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION dispatch_push_notification();

COMMENT ON TABLE push_subscriptions IS 'Web Push subscriptions per user/device for the installable PWA.';
COMMENT ON TABLE app_settings       IS 'Internal key/value config read by DB triggers (no RLS policies on purpose).';
