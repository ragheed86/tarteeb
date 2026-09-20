-- ============================================================
--  WhatsApp AI — Phase 7: تخزين تحليل الصور (Vision)
--  يستخدمها فرع الوسائط في WF-02 بعد تحليل Claude Vision.
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================
create or replace function public.wa_save_media_analysis(
  p_conversation_id uuid, p_message_id uuid, p_wa_media_id text, p_analysis jsonb, p_model text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_media uuid;
  v_clutter text := lower(coalesce(p_analysis->>'clutter_level',''));
  v_items   text := lower(coalesce(p_analysis->>'items_quantity',''));
  v_need    boolean := case when lower(coalesce(p_analysis->>'potential_organizer_need','')) in ('true','t','yes','نعم') then true
                            when lower(coalesce(p_analysis->>'potential_organizer_need','')) in ('false','f','no','لا') then false else null end;
  v_enough  boolean := case when lower(coalesce(p_analysis->>'enough_for_pricing_review','')) in ('true','t','yes','نعم') then true
                            when lower(coalesce(p_analysis->>'enough_for_pricing_review','')) in ('false','f','no','لا') then false else null end;
begin
  if v_clutter not in ('low','medium','high','very_high') then v_clutter := null; end if;
  if v_items   not in ('low','medium','high','very_high') then v_items := null; end if;

  insert into public.wa_media (conversation_id, message_id, wa_media_id, media_type)
  values (p_conversation_id, p_message_id, p_wa_media_id, 'image') returning id into v_media;

  insert into public.wa_media_analysis (conversation_id, media_id, space_type, clutter_level, items_quantity,
    organizing_complexity, visible_storage, potential_organizer_need, image_quality, enough_for_pricing_review,
    observations, model, raw)
  values (p_conversation_id, v_media, p_analysis->>'space_type', v_clutter, v_items,
    p_analysis->>'organizing_complexity', p_analysis->>'visible_storage', v_need, p_analysis->>'image_quality', v_enough,
    coalesce(p_analysis->'observations','[]'::jsonb), p_model, p_analysis);

  update public.pricing_requests
     set media_summary = coalesce(media_summary,'') ||
         case when media_summary is null or media_summary='' then '' else ' · ' end ||
         'فوضى: '||coalesce(v_clutter,'?')||' / أغراض: '||coalesce(v_items,'?'),
         updated_at = now()
   where conversation_id = p_conversation_id and status = 'NEEDS_PRICING';

  return jsonb_build_object('ok', true, 'media_id', v_media, 'clutter', v_clutter, 'items', v_items);
end $$;
revoke all on function public.wa_save_media_analysis(uuid,uuid,text,jsonb,text) from public, anon;
grant execute on function public.wa_save_media_analysis(uuid,uuid,text,jsonb,text) to service_role;
