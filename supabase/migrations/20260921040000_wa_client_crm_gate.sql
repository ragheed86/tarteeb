-- ============================================================
--  WhatsApp AI — بوابة إدخال العميل للـCRM
--  متطلب المستخدم (2026-09-21): جهات الواتساب لا تُنقل لقائمة عملاء
--  الـCRM تلقائياً؛ تبقى في الصندوق حتى يصنّفها رغد/دلال يدوياً
--  (عميل محتمل=lead / عميل حالي=active) عبر زر «أضف للـCRM».
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================

-- قيمة مصدر جديدة + عمود الظهور في الـCRM + اسم جهة الواتساب على المحادثة
-- (alter type add value يُنفَّذ منفصلاً قبل استخدامه)
alter type public.client_source add value if not exists 'whatsapp';
alter table public.clients add column if not exists in_crm boolean not null default true;
alter table public.wa_conversations add column if not exists contact_name text;

-- استقبال محدّث: العميل الجديد من الواتساب يُنشأ خارج الـCRM (in_crm=false، source=whatsapp)
-- ويُخزَّن اسم الملف الشخصي على المحادثة. العملاء الموجودون مسبقاً (وجود مطابقة wa_id/phone) يبقون كما هم.
create or replace function public.wa_handle_inbound(p_wa_message_id text, p_phone text, p_wa_id text, p_profile_name text, p_message_type text, p_text text, p_media_id text, p_occurred_at timestamptz, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_client public.clients%rowtype; v_conv public.wa_conversations%rowtype; v_msg_id uuid;
  v_existing boolean := false;
  v_norm text := regexp_replace(coalesce(p_phone, p_wa_id, ''), '[^0-9]', '', 'g');
  v_mtype text := case lower(coalesce(p_message_type,'text'))
    when 'audio' then 'voice' when 'text' then 'text' when 'image' then 'image'
    when 'video' then 'video' when 'document' then 'document' when 'location' then 'location' else 'system' end;
begin
  if p_wa_message_id is not null and exists (select 1 from public.communications where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('is_duplicate', true, 'wa_message_id', p_wa_message_id);
  end if;
  select * into v_client from public.clients
   where (wa_id is not null and wa_id = p_wa_id)
      or (v_norm <> '' and phone is not null and regexp_replace(phone,'[^0-9]','','g') = v_norm)
   order by created_at asc limit 1;
  if found then
    v_existing := exists (select 1 from public.projects where client_id = v_client.id) or v_client.status in ('active','completed');
    update public.clients set wa_id = coalesce(wa_id, p_wa_id), last_wa_at = now() where id = v_client.id;
  else
    insert into public.clients (name, phone, wa_id, source, status, in_crm, first_contact_at, last_wa_at)
    values (coalesce(nullif(p_profile_name,''), nullif(p_phone,''), p_wa_id, 'عميل واتساب'),
            p_phone, p_wa_id, 'whatsapp'::public.client_source, 'lead'::public.client_status, false, current_date, now())
    returning * into v_client;
  end if;
  select * into v_conv from public.wa_conversations
   where client_id = v_client.id and pipeline_stage <> 'COMPLETED' order by created_at desc limit 1;
  if not found then
    insert into public.wa_conversations (client_id, wa_id, phone, contact_name, state, pipeline_stage, last_inbound_at, last_message_at)
    values (v_client.id, p_wa_id, p_phone, nullif(p_profile_name,''), 'AI_ACTIVE', 'NEW', now(), now()) returning * into v_conv;
  else
    update public.wa_conversations set last_inbound_at = now(), last_message_at = now(),
           wa_id = coalesce(wa_id, p_wa_id), phone = coalesce(phone, p_phone),
           contact_name = coalesce(contact_name, nullif(p_profile_name,''))
     where id = v_conv.id returning * into v_conv;
  end if;
  insert into public.communications (client_id, conversation_id, channel, direction, body,
                                     wa_message_id, message_type, media_id, status, raw, occurred_at)
  values (v_client.id, v_conv.id, 'whatsapp', 'in', p_text, p_wa_message_id, v_mtype, p_media_id, 'received', p_raw, coalesce(p_occurred_at, now()))
  returning id into v_msg_id;
  return jsonb_build_object('is_duplicate', false, 'client_id', v_client.id, 'conversation_id', v_conv.id,
    'message_id', v_msg_id, 'existing_customer', v_existing, 'message_type', v_mtype, 'text', p_text,
    'media_id', p_media_id, 'state', v_conv.state, 'automation_paused', v_conv.automation_paused,
    'pipeline_stage', v_conv.pipeline_stage, 'district', v_client.district, 'service_type', v_client.service_type);
end $function$;

-- نقل جهة واتساب إلى الـCRM بتصنيف يدوي (محكوم بصلاحية whatsapp؛ يستدعيه CRM)
create or replace function public.wa_conversation_to_crm(p_conversation_id uuid, p_status text default 'lead')
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_conv public.wa_conversations%rowtype; v_client_id uuid; v_name text;
  v_status public.client_status := case when lower(coalesce(p_status,'')) in ('lead','active','completed','waiting')
                                        then lower(p_status)::public.client_status else 'lead'::public.client_status end;
begin
  if not public.has_permission('whatsapp') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into v_conv from public.wa_conversations where id = p_conversation_id;
  if not found then return jsonb_build_object('error', 'conversation_not_found'); end if;
  v_client_id := v_conv.client_id;
  if v_client_id is null then
    insert into public.clients (name, phone, wa_id, source, status, in_crm, first_contact_at, last_wa_at)
    values (coalesce(nullif(v_conv.contact_name,''), nullif(v_conv.phone,''), v_conv.wa_id, 'عميل واتساب'),
            v_conv.phone, v_conv.wa_id, 'whatsapp'::public.client_source, v_status, true, current_date, now())
    returning id, name into v_client_id, v_name;
    update public.wa_conversations set client_id = v_client_id where id = p_conversation_id;
    update public.communications set client_id = v_client_id where conversation_id = p_conversation_id and client_id is null;
  else
    update public.clients set in_crm = true, status = v_status, updated_at = now()
     where id = v_client_id returning name into v_name;
  end if;
  return jsonb_build_object('ok', true, 'client_id', v_client_id, 'name', v_name, 'status', v_status);
end $function$;
revoke all on function public.wa_conversation_to_crm(uuid,text) from public, anon;
grant execute on function public.wa_conversation_to_crm(uuid,text) to authenticated, service_role;
