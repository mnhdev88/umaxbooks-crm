-- ──────────────────────────────────────────────────────────────
-- 002: Notification enhancements
--   • link column for in-app navigation
--   • Admin SELECT policy (god-view)
--   • Auto-notifications via triggers:
--       - Lead status change  → assigned agent + client portal user
--       - Client invited      → all admins
--       - Deal payment change → assigned agent + admins
--   • pg_cron daily cleanup (delete rows older than 3 days)
--
-- PREREQUISITE for pg_cron section:
--   Enable the pg_cron extension in Supabase Dashboard first:
--   Database → Extensions → pg_cron → Enable
-- ──────────────────────────────────────────────────────────────

-- ── 1. Add link column ────────────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- ── 2. Admin god-view SELECT policy ──────────────────────────
DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
CREATE POLICY "Admins can view all notifications"
  ON notifications FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── 3. Trigger: lead status change ───────────────────────────
CREATE OR REPLACE FUNCTION notify_lead_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN

    -- Notify assigned agent
    IF NEW.assigned_agent_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, lead_id, title, message, type, link)
      VALUES (
        NEW.assigned_agent_id,
        NEW.id,
        'Lead Status Updated',
        NEW.company_name || ' moved to ' || NEW.status,
        'info',
        '/leads/' || NEW.id
      );
    END IF;

    -- Notify client portal user (if one exists for this lead)
    INSERT INTO notifications (user_id, lead_id, title, message, type, link)
    SELECT p.id, NEW.id,
      'Project Status Updated',
      'Your project status is now: ' || NEW.status,
      'success',
      '/portal'
    FROM profiles p
    WHERE p.lead_id = NEW.id AND p.role = 'client';

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_status_change ON leads;
CREATE TRIGGER trg_lead_status_change
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION notify_lead_status_change();

-- ── 4. Trigger: new client invited → notify all admins ────────
CREATE OR REPLACE FUNCTION notify_client_invited()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role = 'client' THEN
    INSERT INTO notifications (user_id, title, message, type, link)
    SELECT p.id,
      'New Client Invited',
      NEW.full_name || ' has been invited to the client portal',
      'info',
      '/clients'
    FROM profiles p
    WHERE p.role = 'admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_invited ON profiles;
CREATE TRIGGER trg_client_invited
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION notify_client_invited();

-- ── 5. Trigger: deal payment status change ────────────────────
CREATE OR REPLACE FUNCTION notify_deal_payment_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company  TEXT;
  v_agent_id UUID;
  v_type     TEXT;
BEGIN
  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN

    SELECT l.company_name, l.assigned_agent_id
      INTO v_company, v_agent_id
      FROM leads l WHERE l.id = NEW.lead_id;

    v_type := CASE NEW.payment_status
      WHEN 'Paid'    THEN 'success'
      WHEN 'Overdue' THEN 'error'
      ELSE 'warning'
    END;

    -- Notify assigned agent
    IF v_agent_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, lead_id, title, message, type, link)
      VALUES (
        v_agent_id, NEW.lead_id,
        'Payment Status: ' || NEW.payment_status,
        v_company || ' — ' || NEW.payment_status,
        v_type,
        '/leads/' || NEW.lead_id
      );
    END IF;

    -- Notify admins (skip if admin is already the assigned agent)
    INSERT INTO notifications (user_id, lead_id, title, message, type, link)
    SELECT p.id, NEW.lead_id,
      'Payment Status: ' || NEW.payment_status,
      v_company || ' — ' || NEW.payment_status,
      v_type,
      '/leads/' || NEW.lead_id
    FROM profiles p
    WHERE p.role = 'admin'
      AND (v_agent_id IS NULL OR p.id <> v_agent_id);

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_payment_change ON deals;
CREATE TRIGGER trg_deal_payment_change
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_deal_payment_change();

-- ── 6. pg_cron: delete notifications older than 3 days ───────
-- Run this block only after enabling pg_cron in Supabase Dashboard.
DO $$
BEGIN
  -- Unschedule existing job if present (ignore error if not found)
  BEGIN
    PERFORM cron.unschedule('delete-old-notifications');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'delete-old-notifications',
    '0 3 * * *',
    $$DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '3 days'$$
  );
END;
$$;
