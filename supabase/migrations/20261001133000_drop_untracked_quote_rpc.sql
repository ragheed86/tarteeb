-- An earlier save_quote_with_items(jsonb, jsonb, uuid, timestamptz) was created
-- in production outside the migration history (no source in the repo, no app
-- code calls it). It accepts the same named arguments as the version in
-- 20261001130000, which makes PostgREST/RPC calls ambiguous. Remove it so only
-- the reviewed version remains.
drop function if exists public.save_quote_with_items(jsonb, jsonb, uuid, timestamptz);
