-- ============================================================
--  WF-01 ingest RPC — إدخال رسالة واتساب واردة بشكل ذرّي (deterministic)
--  يتولّى: idempotency + التعرّف على العميل بالهاتف + إنشاء Lead جديد +
--          فتح/جلب محادثة + كتابة الرسالة + إرجاع السياق للأتمتة.
--  يُستدعى من n8n عبر service_role (أو أي منفّذ) — security definer يتجاوز RLS.
-- ============================================================
create or replace function public.wa_handle_inbound(
  p_wa_message_id text,
  p_phone         text,
  p_wa_id         text,
  p_profile_name  text,
  p_message_type  text,
  p_text          text,
  p_media_id      text,
  p_occurred_at   timestamptz,
  p_raw           jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client   public.clients%rowtype;
  v_conv     public.wa_conversations%rowtype;
  v_msg_id   uuid;
  v_existing boolean := false;
  v_norm     text := regexp_replace(coalesce(p_phone, p_wa_id, ''), '[^0-9]', '', 'g');
  v_mtype    text := case lower(coalesce(p_message_type,'text'))
                       when 'audio'    then 'voice'
                       when 'text'     then 'text'
                       when 'image'    then 'image'
                       when 'video'    then 'video'
                       when 'document' then 'document'
                       when 'location' then 'location'
                       else 'system' end;
begin
  -- 1) idempotency: نفس رسالة واتساب لا تُعالَج مرتين
  if p_wa_message_id is not null
     and exists (select 1 from public.communications where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('is_duplicate', true, 'wa_message_id', p_wa_message_id);
  end if;

  -- 2) التعرّف على العميل (wa_id أو الهاتف المُطبّع)
  select * into v_client from public.clients
   where (wa_id is not null and wa_id = p_wa_id)
      or (v_norm <> '' and phone is not null and regexp_replace(phone,'[^0-9]','','g') = v_norm)
   order by created_at asc limit 1;

  if found then
    v_existing := exists (select 1 from public.projects where client_id = v_client.id)
                  or v_client.status in ('active','completed');
    update public.clients
       set wa_id = coalesce(wa_id, p_wa_id), last_wa_at = now()
     where id = v_client.id;
  else
    insert into public.clients (name, phone, wa_id, source, status, first_contact_at, last_wa_at)
    values (coalesce(nullif(p_profile_name,''), nullif(p_phone,''), p_wa_id, 'عميل واتساب'),
            p_phone, p_wa_id, 'unknown'::public.client_source, 'lead'::public.client_status,
            current_date, now())
    returning * into v_client;
    v_existing := false;
  end if;

  -- 3) فتح/جلب محادثة مفتوحة
  select * into v_conv from public.wa_conversations
   where client_id = v_client.id and pipeline_stage <> 'COMPLETED'
   order by created_at desc limit 1;
  if not found then
    insert into public.wa_conversations (client_id, wa_id, phone, state, pipeline_stage,
                                         last_inbound_at, last_message_at)
    values (v_client.id, p_wa_id, p_phone, 'AI_ACTIVE', 'NEW', now(), now())
    returning * into v_conv;
  else
    update public.wa_conversations
       set last_inbound_at = now(), last_message_at = now(),
           wa_id = coalesce(wa_id, p_wa_id), phone = coalesce(phone, p_phone)
     where id = v_conv.id
     returning * into v_conv;
  end if;

  -- 4) كتابة الرسالة الواردة
  insert into public.communications (client_id, conversation_id, channel, direction, body,
                                     wa_message_id, message_type, media_id, status, raw, occurred_at)
  values (v_client.id, v_conv.id, 'whatsapp', 'in', p_text,
          p_wa_message_id, v_mtype, p_media_id, 'received', p_raw, coalesce(p_occurred_at, now()))
  returning id into v_msg_id;

  -- 5) إرجاع السياق للأتمتة (WF-02+)
  return jsonb_build_object(
    'is_duplicate',      false,
    'client_id',         v_client.id,
    'conversation_id',   v_conv.id,
    'message_id',        v_msg_id,
    'existing_customer', v_existing,
    'message_type',      v_mtype,
    'media_id',          p_media_id,
    'state',             v_conv.state,
    'automation_paused', v_conv.automation_paused,
    'pipeline_stage',    v_conv.pipeline_stage
  );
end $$;

revoke all on function public.wa_handle_inbound(text,text,text,text,text,text,text,timestamptz,jsonb) from public, anon;
grant execute on function public.wa_handle_inbound(text,text,text,text,text,text,text,timestamptz,jsonb) to service_role;
