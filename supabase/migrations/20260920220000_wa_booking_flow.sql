-- ============================================================
--  WhatsApp AI — Phase 11: تدفّق الحجز (إنشاء طلب + قرار بشري)
--  لا تأكيد آلي أبداً — التأكيد بشري (whatsapp_booking).
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================

-- إنشاء طلب حجز بانتظار موافقة بشرية
create or replace function public.wa_create_booking(
  p_conversation_id uuid, p_date date, p_time text, p_datetime timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conv public.wa_conversations%rowtype; v_bid uuid;
begin
  select * into v_conv from public.wa_conversations where id = p_conversation_id;
  if not found then return jsonb_build_object('error','conversation_not_found'); end if;
  select id into v_bid from public.booking_requests
   where conversation_id = p_conversation_id and status = 'WAITING_APPROVAL' order by created_at desc limit 1;
  if v_bid is null then
    insert into public.booking_requests (conversation_id, client_id, requested_date, requested_time, requested_datetime, status)
    values (p_conversation_id, v_conv.client_id, p_date, p_time, p_datetime, 'WAITING_APPROVAL')
    returning id into v_bid;
  end if;
  update public.wa_conversations set state='WAITING_BOOKING_APPROVAL', pipeline_stage='BOOKING_PENDING', last_message_at=now()
   where id = p_conversation_id;
  return jsonb_build_object('booking_id', v_bid);
end $$;

-- قرار الحجز (confirm|reject|reschedule) — محصور بصلاحية whatsapp_booking + صياغة رد العميل
create or replace function public.wa_decide_booking(
  p_booking_id uuid, p_decision text, p_calendar_event_id text, p_suggested timestamptz, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_b public.booking_requests%rowtype; v_conv uuid; v_client uuid; v_msg uuid; v_reply text; v_when text;
begin
  if not public.has_permission('whatsapp_booking') then
    raise exception 'forbidden: whatsapp_booking required';
  end if;
  select * into v_b from public.booking_requests where id = p_booking_id;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;
  v_conv := v_b.conversation_id; v_client := v_b.client_id;
  v_when := coalesce(to_char(v_b.requested_date,'FMDD/FMMM/YYYY'), '') ||
            case when v_b.requested_time is not null and v_b.requested_time<>'' then ' الساعة '||v_b.requested_time else '' end;

  if p_decision = 'confirm' then
    update public.booking_requests set status='CONFIRMED', calendar_event_id=p_calendar_event_id,
           decided_by=(select auth.uid()), decided_by_email=lower(coalesce((select auth.jwt())->>'email','')),
           decided_at=now(), notes=p_notes, updated_at=now() where id=p_booking_id;
    v_reply := format('تم تأكيد موعدك 📅 %s. بانتظارك، وأي استفسار إحنا بخدمتك!', v_when);
    update public.wa_conversations set pipeline_stage='BOOKED', state='AI_ACTIVE', last_message_at=now() where id=v_conv;
  elsif p_decision = 'reject' then
    update public.booking_requests set status='REJECTED',
           decided_by=(select auth.uid()), decided_by_email=lower(coalesce((select auth.jwt())->>'email','')),
           decided_at=now(), notes=p_notes, updated_at=now() where id=p_booking_id;
    v_reply := 'نعتذر، الموعد اللي طلبته غير متاح حالياً. تحب نرشّح لك وقت ثاني قريب؟';
    update public.wa_conversations set state='AI_ACTIVE', last_message_at=now() where id=v_conv;
  elsif p_decision = 'reschedule' then
    update public.booking_requests set status='RESCHEDULE_SUGGESTED', suggested_datetime=p_suggested,
           decided_by=(select auth.uid()), decided_by_email=lower(coalesce((select auth.jwt())->>'email','')),
           decided_at=now(), notes=p_notes, updated_at=now() where id=p_booking_id;
    v_reply := format('ما ظبط الموعد المطلوب، بس نقدر نخدمك %s. يناسبك؟', to_char(coalesce(p_suggested, now()), 'FMDD/FMMM HH24:MI'));
    update public.wa_conversations set state='WAITING_BOOKING_APPROVAL', last_message_at=now() where id=v_conv;
  else
    return jsonb_build_object('error','invalid_decision');
  end if;

  insert into public.communications (client_id, conversation_id, channel, direction, body, message_type, status, ai_processed, occurred_at)
  values (v_client, v_conv, 'whatsapp', 'out', v_reply, 'text', 'pending_send', true, now())
  returning id into v_msg;
  insert into public.automation_events (conversation_id, event_type, severity, detail)
  values (v_conv, 'booking_'||p_decision, 'info', jsonb_build_object('booking_id',p_booking_id,'message_id',v_msg));
  return jsonb_build_object('ok', true, 'message_id', v_msg, 'reply', v_reply);
end $$;

revoke all on function public.wa_create_booking(uuid,date,text,timestamptz) from public, anon;
revoke all on function public.wa_decide_booking(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.wa_create_booking(uuid,date,text,timestamptz) to service_role;
grant execute on function public.wa_decide_booking(uuid,text,text,timestamptz,text) to authenticated, service_role;
