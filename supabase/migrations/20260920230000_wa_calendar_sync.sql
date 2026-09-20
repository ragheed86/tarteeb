-- ============================================================
--  WhatsApp AI — Phase 11 (تكملة): مزامنة Google Calendar
--  يستخدمها workflow «WhatsApp Calendar Sync» في n8n (124ud0iXABGAAaOX):
--  Schedule → wa_pending_calendar_events → Google Calendar Create → wa_set_calendar_event
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================

-- الحجوزات المؤكَّدة التي تنتظر إنشاء حدث تقويم (start/end جاهزة كـ ISO)
create or replace function public.wa_pending_calendar_events()
returns table(booking_id uuid, summary text, description text, start_iso text, end_iso text)
language sql stable security definer set search_path = '' as $$
  select b.id,
         'موعد ترتيب — ' || coalesce(cl.name, 'عميل') as summary,
         'الخدمة: ' || coalesce(cl.service_type, '—') || E'\nالحي: ' || coalesce(cl.district, '—') ||
           E'\nالجوال: ' || coalesce(cl.phone, '') ||
           case when b.requested_time is not null and b.requested_time <> '' then E'\nالوقت المطلوب: ' || b.requested_time else '' end ||
           case when b.notes is not null and b.notes <> '' then E'\nملاحظات: ' || b.notes else '' end as description,
         to_char(coalesce(b.requested_datetime, b.suggested_datetime, (b.requested_date::timestamp + interval '12 hours'), now()),
                 'YYYY-MM-DD"T"HH24:MI:SS') as start_iso,
         to_char(coalesce(b.requested_datetime, b.suggested_datetime, (b.requested_date::timestamp + interval '12 hours'), now()) + interval '2 hours',
                 'YYYY-MM-DD"T"HH24:MI:SS') as end_iso
  from public.booking_requests b
  join public.clients cl on cl.id = b.client_id
  where b.status = 'CONFIRMED' and b.calendar_event_id is null;
$$;

-- تخزين معرّف حدث التقويم بعد إنشائه
create or replace function public.wa_set_calendar_event(p_booking_id uuid, p_event_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_requests set calendar_event_id = p_event_id, updated_at = now() where id = p_booking_id;
  return jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'event_id', p_event_id);
end $$;

revoke all on function public.wa_pending_calendar_events() from public, anon;
revoke all on function public.wa_set_calendar_event(uuid,text) from public, anon;
grant execute on function public.wa_pending_calendar_events() to service_role;
grant execute on function public.wa_set_calendar_event(uuid,text) to service_role;
