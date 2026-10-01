-- Loan helpers are internal: the trigger function fires on loan_payments
-- changes and calls the other two as its owner (security definer). None is
-- called from the app, so nobody needs to reach them through the API.
-- Previously anon could call them via /rest/v1/rpc/*.
revoke execute on function public.loan_payments_after_change() from public, anon, authenticated;
revoke execute on function public.loan_recalc_installment(uuid) from public, anon, authenticated;
revoke execute on function public.loan_sync_status(uuid) from public, anon, authenticated;
