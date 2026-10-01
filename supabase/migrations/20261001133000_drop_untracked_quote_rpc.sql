-- An older save_quote_with_items(jsonb, jsonb, uuid, timestamptz) exists in
-- production from migration 20260903082005_transactional_quotes_and_optimistic_inventory,
-- which was applied to production but never committed to this repo (see
-- docs/DB_DRIFT_2026-10-01.md). No code on main calls it. It accepts the same
-- named arguments as the version in 20261001130000, which makes RPC calls
-- ambiguous, so it is removed and only the reviewed version remains.
drop function if exists public.save_quote_with_items(jsonb, jsonb, uuid, timestamptz);
