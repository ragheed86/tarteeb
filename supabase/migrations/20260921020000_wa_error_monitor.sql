-- ============================================================
--  WhatsApp AI — Phase 13: مراقب الأخطاء
--  workflow «WhatsApp Error Monitor» (NGaHUr94lPcOGTER) = errorWorkflow
--  لكل workflows واتساب؛ Error Trigger → wa_log_workflow_error → automation_events.
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================
create or replace function public.wa_log_workflow_error(p_workflow text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.automation_events (event_type, severity, detail)
  values ('workflow_error', 'critical', jsonb_build_object('workflow', p_workflow) || coalesce(p_detail,'{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'event_id', v_id);
end $$;
revoke all on function public.wa_log_workflow_error(text,jsonb) from public, anon;
grant execute on function public.wa_log_workflow_error(text,jsonb) to service_role;
