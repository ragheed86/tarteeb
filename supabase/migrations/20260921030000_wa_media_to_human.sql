-- ============================================================
--  WhatsApp AI — سلوك الوسائط: استلام قصير ثم تحويل بشري
--  متطلب المستخدم (2026-09-21): الصور/الفيديو لا يردّ عليها الذكاء،
--  بل يرسل إشعار استلام ثم ينتظر رغد/دلال للرد اليدوي.
--  WF-01: فرع الصور (Save Analysis) وفرع الفيديو (Route Media Type→video)
--  يصبّان في عقدة «Media To Human» التي تستدعي هذه الدالة.
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================
create or replace function public.wa_media_to_human(p_conversation_id uuid, p_media_type text default 'image')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid; v_msg uuid;
  v_kind text := case when lower(coalesce(p_media_type,'')) = 'video' then 'الفيديو' else 'الصور' end;
  v_text text;
begin
  v_text := 'وصلنا ' || v_kind || ' 🌟 رح تطّلع عليها الإدارة وترد عليك بأقرب وقت 🌷';
  select client_id into v_client from public.wa_conversations where id = p_conversation_id;
  -- إشعار استلام صادر (pending_send) — يمرّ عبر بوابة الإرسال WF-06
  insert into public.communications (client_id, conversation_id, channel, direction, body, message_type, status, ai_processed, occurred_at)
  values (v_client, p_conversation_id, 'whatsapp', 'out', v_text, 'text', 'pending_send', true, now())
  returning id into v_msg;
  -- إيقاف الأتمتة + تحويل بشري ليردّ رغد/دلال يدوياً
  update public.wa_conversations
     set automation_paused = true, state = 'HUMAN_TAKEOVER', last_message_at = now()
   where id = p_conversation_id;
  insert into public.automation_events (conversation_id, event_type, severity, detail)
  values (p_conversation_id, 'media_to_human', 'info', jsonb_build_object('media_type', p_media_type, 'message_id', v_msg));
  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $$;
revoke all on function public.wa_media_to_human(uuid,text) from public, anon;
grant execute on function public.wa_media_to_human(uuid,text) to service_role;
