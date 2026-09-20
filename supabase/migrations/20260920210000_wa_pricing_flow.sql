-- ============================================================
--  WhatsApp AI — Phase 10: تدفّق التسعير (بدء + اعتماد)
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================

-- بدء التسعير: يفحص اكتمال (خدمة/حي/وسائط)، يحفظ التلميحات، وينشئ طلب تسعير عند الاكتمال
create or replace function public.wa_start_pricing(p_conversation_id uuid, p_service text, p_district text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_conv public.wa_conversations%rowtype; v_client public.clients%rowtype;
  v_service text; v_district text; v_media int; v_missing text[] := '{}'; v_pr uuid;
begin
  select * into v_conv from public.wa_conversations where id = p_conversation_id;
  if not found then return jsonb_build_object('error','conversation_not_found'); end if;
  select * into v_client from public.clients where id = v_conv.client_id;

  v_service  := coalesce(nullif(p_service,''),  v_client.service_type);
  v_district := coalesce(nullif(p_district,''), v_client.district);
  update public.clients set service_type = coalesce(service_type, nullif(p_service,'')),
                            district = coalesce(district, nullif(p_district,'')) where id = v_client.id;

  select count(*) into v_media from public.communications
   where conversation_id = p_conversation_id and message_type in ('image','video');

  if v_service  is null then v_missing := array_append(v_missing, 'service');  end if;
  if v_district is null then v_missing := array_append(v_missing, 'district'); end if;
  if v_media = 0        then v_missing := array_append(v_missing, 'media');    end if;

  if array_length(v_missing,1) is null then
    select id into v_pr from public.pricing_requests
     where conversation_id = p_conversation_id and status = 'NEEDS_PRICING' order by created_at desc limit 1;
    if v_pr is null then
      insert into public.pricing_requests (conversation_id, client_id, service_type, district, status, media_summary)
      values (p_conversation_id, v_client.id, v_service, v_district, 'NEEDS_PRICING', format('%s صورة/فيديو', v_media))
      returning id into v_pr;
    end if;
    update public.wa_conversations set state='WAITING_PRICING', pipeline_stage='NEEDS_PRICING' where id = p_conversation_id;
    return jsonb_build_object('ready', true, 'missing', '[]'::jsonb, 'pricing_request_id', v_pr);
  end if;

  update public.wa_conversations
     set state='COLLECTING_INFO',
         pipeline_stage = case when pipeline_stage='NEW' then 'COLLECTING_INFO' else pipeline_stage end
   where id = p_conversation_id;
  return jsonb_build_object('ready', false, 'missing', to_jsonb(v_missing), 'pricing_request_id', null);
end $$;

-- اعتماد السعر (محصور بصلاحية whatsapp_pricing) + صياغة الرد المسعّر وإدراجه معلّقاً
create or replace function public.wa_approve_pricing(p_pricing_request_id uuid, p_price numeric, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pr public.pricing_requests%rowtype; v_conv uuid; v_client uuid; v_msg uuid; v_reply text; v_svc text;
begin
  if not public.has_permission('whatsapp_pricing') then
    raise exception 'forbidden: whatsapp_pricing required';
  end if;
  select * into v_pr from public.pricing_requests where id = p_pricing_request_id;
  if not found then return jsonb_build_object('error','pricing_request_not_found'); end if;

  update public.pricing_requests
     set approved_price = p_price, notes = p_notes, status = 'PRICED',
         approved_by = (select auth.uid()),
         approved_by_email = lower(coalesce((select auth.jwt()) ->> 'email','')),
         approved_at = now(), updated_at = now()
   where id = p_pricing_request_id
   returning conversation_id, client_id into v_conv, v_client;

  v_svc := case v_pr.service_type
             when 'kitchen' then 'المطبخ' when 'closet' then 'غرفة الملابس' when 'bedroom' then 'غرفة النوم'
             when 'storage' then 'المستودع' when 'office' then 'المكتب' when 'laundry' then 'غرفة الغسيل'
             else 'المكان' end;
  v_reply := format('سعر خدمة ترتيب %s هو %s ريال 🌟%sالسعر يشمل الترتيب والتنظيم الاحترافي للمكان. تحب نحدّد لك موعد؟',
                    v_svc, trim(to_char(p_price,'FM999999990')), E'\n');

  insert into public.communications (client_id, conversation_id, channel, direction, body, message_type, status, ai_processed, occurred_at)
  values (v_client, v_conv, 'whatsapp', 'out', v_reply, 'text', 'pending_send', true, now())
  returning id into v_msg;

  update public.wa_conversations set pipeline_stage='QUOTE_SENT', state='AI_ACTIVE', last_message_at=now() where id = v_conv;
  insert into public.automation_events (conversation_id, event_type, severity, detail)
  values (v_conv, 'price_approved', 'info', jsonb_build_object('pricing_request_id',p_pricing_request_id,'price',p_price,'message_id',v_msg));

  return jsonb_build_object('ok', true, 'message_id', v_msg, 'reply', v_reply);
end $$;

revoke all on function public.wa_start_pricing(uuid,text,text) from public, anon;
revoke all on function public.wa_approve_pricing(uuid,numeric,text) from public, anon;
grant execute on function public.wa_start_pricing(uuid,text,text) to service_role;
grant execute on function public.wa_approve_pricing(uuid,numeric,text) to authenticated, service_role;
