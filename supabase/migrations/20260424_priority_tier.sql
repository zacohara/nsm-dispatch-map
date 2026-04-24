-- v0.19: Rep priority tiers for fit scoring
--
-- Adds a tier bias to the "best fit" recommender so dispatchers can rank reps
-- by business preference, not just geographic detour. The scorer applies a
-- virtual mileage adjustment:
--   tier 1 (preferred)  → added_miles − 8
--   tier 2 (standard)   → added_miles + 0
--   tier 3 (backup)     → added_miles + 8
-- So preferred reps still win when the detour is comparable, but a truly
-- shorter route from a tier-3 rep can still surface.

BEGIN;

ALTER TABLE dispatch_crews
  ADD COLUMN IF NOT EXISTS priority_tier SMALLINT NOT NULL DEFAULT 2
  CHECK (priority_tier BETWEEN 1 AND 3);

COMMIT;
