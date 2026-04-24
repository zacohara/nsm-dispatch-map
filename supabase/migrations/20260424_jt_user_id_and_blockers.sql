-- v0.18e: Rep availability blockers + JT user ID attribution
--
-- Adds two things:
--   1. dispatch_crews.jt_user_id — the JobTread user ID for this rep, matched
--      via the memberships collection. Enables the sync to attribute tasks by
--      assignedMemberships (the actual JT assignee) instead of relying only on
--      the Sales Rep custom field (which is missing on blocker-style tasks).
--
--   2. dispatch_tasks.is_blocker — true when the task is a rep availability
--      block (WFH / PTO / sick / doctor / etc.) rather than actual dispatch
--      work. Sync detects these by taskType = '1 Urgent Must Do' plus a name
--      keyword match. UI shows them as hatched "unavailable" strips on the
--      rep's day instead of real pins, and suggest-slots treats the [start,
--      start + duration_hrs) window as busy so leads never get booked on top
--      of them.

BEGIN;

ALTER TABLE dispatch_crews
  ADD COLUMN IF NOT EXISTS jt_user_id TEXT;

-- index for the repByJtUserId lookup on every sync
CREATE INDEX IF NOT EXISTS idx_dispatch_crews_jt_user_id
  ON dispatch_crews(jt_user_id)
  WHERE jt_user_id IS NOT NULL;

ALTER TABLE dispatch_tasks
  ADD COLUMN IF NOT EXISTS is_blocker BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index so the "show me today's blockers" filter is fast without
-- bloating the index on the 99% of rows that aren't blockers.
CREATE INDEX IF NOT EXISTS idx_dispatch_tasks_blockers
  ON dispatch_tasks(crew_id, scheduled_date)
  WHERE is_blocker = TRUE;

COMMIT;
