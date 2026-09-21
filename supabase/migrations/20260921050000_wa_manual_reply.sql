-- ============================================================
--  WhatsApp AI — الرد اليدوي من الصندوق (رغد/دلال)
--  يُكمّل تدفّق الاستلام البشري: بعد تحويل المحادثة للبشر (وسائط/تصعيد)
--  يردّ رغد/دلال يدوياً من /inbox. بلا حارس السعر لأن البشر مخوّلون
--  بإعطاء الأسعار. محكوم بصلاحية whatsapp. يمرّ عبر بوابة الإرسال WF-06.
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================
create or replace function public.wa_send_manual_reply(p_conversation_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_client uuid; v_msg uuid;
begin
  if not public.has_permission('whatsapp') then return jsonb_build_object('error','forbidden'); end if;
  if p_text is null or btrim(p_text) = '' then return jsonb_build_object('error','empty'); end if;
  select client_id into v_client from public.wa_conversations where id = p_conversation_id;
  insert into public.communications (client_id, conversation_id, channel, direction, body, message_type, status, ai_processed, occurred_at)
  values (v_client, p_conversation_id, 'whatsapp', 'out', p_text, 'text', 'pending_send', false, now())
  returning id into v_msg;
  -- الإرسال اليدوي = استلام بشري: أوقف الأتمتة لهذي المحادثة
  update public.wa_conversations set automation_paused = true, state = 'HUMAN_TAKEOVER', last_message_at = now()
   where id = p_conversation_id;
  insert into public.automation_events (conversation_id, event_type, severity, detail)
  values (p_conversation_id, 'manual_reply', 'info', jsonb_build_object('message_id', v_msg));
  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $function$;
revoke all on function public.wa_send_manual_reply(uuid,text) from public, anon;
grant execute on function public.wa_send_manual_reply(uuid,text) to authenticated, service_role;
