-- Audit note approval gate.
--
-- Before: a sales agent's note in the Audit tab went straight to every developer
-- and flipped the lead to "Audit Ready".
-- After: a sales_agent's note is held as 'pending'. A sales manager (or admin)
-- reviews it on /note-approvals and writes their OWN note to the developer.
-- Only that manager note reaches the developer thread + Dev Queue.
--
-- Notes written by sales_manager / admin / developer are auto-approved on insert,
-- so their behaviour is unchanged.

-- ── 1. Approval columns ─────────────────────────────────────────────────────
ALTER TABLE audit_notes
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decline_reason  TEXT,
  -- When a manager approves, their new note links back to the agent request it answers.
  ADD COLUMN IF NOT EXISTS source_note_id  UUID REFERENCES audit_notes(id) ON DELETE SET NULL;

ALTER TABLE audit_notes DROP CONSTRAINT IF EXISTS audit_notes_approval_status_check;
ALTER TABLE audit_notes ADD CONSTRAINT audit_notes_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'declined'));

-- Every pre-existing note was already visible to developers — keep it that way.
UPDATE audit_notes SET approval_status = 'approved' WHERE approval_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_notes_approval_status
  ON audit_notes(approval_status) WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_audit_notes_source_note ON audit_notes(source_note_id);

-- ── 2. Force the gate server-side ───────────────────────────────────────────
-- The client can't opt out of approval by simply not sending the column: a
-- sales_agent's note is always stamped 'pending', everyone else's 'approved'.
CREATE OR REPLACE FUNCTION set_audit_note_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  author_role TEXT;
BEGIN
  SELECT role INTO author_role FROM profiles WHERE id = NEW.user_id;

  IF author_role = 'sales_agent' THEN
    NEW.approval_status := 'pending';
    NEW.reviewed_by     := NULL;
    NEW.reviewed_at     := NULL;
  ELSE
    NEW.approval_status := 'approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_audit_note_approval ON audit_notes;
CREATE TRIGGER trg_set_audit_note_approval
  BEFORE INSERT ON audit_notes
  FOR EACH ROW EXECUTE FUNCTION set_audit_note_approval();

-- ── 3. Only a manager or admin can review ───────────────────────────────────
-- audit_notes previously had a blanket "any authenticated user can insert" and
-- no UPDATE policy at all. Add UPDATE, restricted to reviewers.
DROP POLICY IF EXISTS "Managers and admins can review audit notes" ON audit_notes;
CREATE POLICY "Managers and admins can review audit notes"
  ON audit_notes FOR UPDATE USING (
    (select get_my_role()) IN ('admin', 'sales_manager')
  ) WITH CHECK (
    (select get_my_role()) IN ('admin', 'sales_manager')
  );

-- ── 4. Hide pending notes from developers ───────────────────────────────────
-- Replaces the blanket authenticated-read policy: a developer must not see a
-- note that hasn't cleared approval yet. Agents still see their own pending
-- notes (so the "Pending Approval" badge renders in their Audit tab).
DROP POLICY IF EXISTS "Authenticated users can read audit notes" ON audit_notes;
CREATE POLICY "Authenticated users can read audit notes"
  ON audit_notes FOR SELECT USING (
    approval_status <> 'pending'
    OR user_id = (select auth.uid())
    OR (select get_my_role()) IN ('admin', 'sales_manager')
  );
