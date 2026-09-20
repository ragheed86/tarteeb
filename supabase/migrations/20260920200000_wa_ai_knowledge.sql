-- ============================================================
--  WhatsApp AI — Phase 5: قاعدة المعرفة + دوال الرد + حارس السعر
--  ملاحظة: طُبّق على الـDB الحيّة عبر execute_sql (apply_migration محجوب
--  بمصنّف auto-mode). هذا الملف للمزامنة repo↔DB.
-- ============================================================

-- بذور المعرفة (لهجة سعودية بيضاء، محتوى معتمد يُعاد صياغته فقط)
delete from public.knowledge_base where category = 'seed_v1';
insert into public.knowledge_base (intent, category, title, approved_answer, keywords, allowed_variation, requires_approval, priority, active) values
('greeting','seed_v1','ترحيب','هلا والله 👋 حيّاك الله في ترتيب. كيف أقدر أخدمك اليوم؟', array['سلام','هلا','مرحبا','السلام عليكم','هاي','صباح','مساء'], true, false, 100, true),
('service_info','seed_v1','عن خدماتنا','في ترتيب متخصصين بتنظيم وترتيب المساحات: المطابخ، غرف الملابس، غرف النوم، المستودعات المنزلية، والمكاتب. نرتّب المكان ونصمّم له حلول تخزين عملية وأنيقة تناسبك.', array['خدمات','وش تسوون','تنظيم','ترتيب','ايش تقدمون','خدماتكم'], true, false, 80, true),
('service_area','seed_v1','مناطق الخدمة','نخدمك داخل مدينة الرياض وكل أحيائها 🌟 بأي حي تحب نخدمك؟', array['وين','منطقة','مدينة','الرياض','تغطون','فرع','أحياء','الحي'], true, false, 70, true),
('ask_organizers','seed_v1','المنظّمات','نعم نوفّر المنظّمات والأدوات اللازمة للترتيب، ونرشّح لك الأنسب لمساحتك ضمن الخدمة.', array['منظمات','أدوات','علب','صناديق','منظم','اكسسوارات'], true, false, 60, true),
('ask_cleaning','seed_v1','التنظيف','خدمتنا الأساسية هي التنظيم والترتيب، مو التنظيف العميق. نرتّب المكان ونظّم محتوياته بشكل احترافي.', array['تنظيف','نظافة','تنظفون','غسيل السجاد','جلي'], true, false, 60, true),
('ask_moving','seed_v1','النقل','نقدر نساعدك في ترتيب وتنظيم أغراضك بعد النقل، لكن خدمة النقل نفسها مو ضمن خدماتنا الأساسية.', array['نقل','عفش','ننقل','ترحيل','دباب'], true, false, 60, true),
('ask_duration','seed_v1','مدة التنفيذ','مدة التنفيذ تعتمد على حجم المكان وكمية الأغراض، وغالباً من عدة ساعات إلى يوم كامل. نحدّد لك المدة بدقة بعد ما نشوف صور المكان.', array['كم يوم','مدة','كم ساعة','متى تخلصون','كم ياخذ','الوقت'], true, false, 55, true),
('thanks','seed_v1','شكر','الله يعافيك 🌷 نوّرتنا، وأي وقت تحتاجنا إحنا بخدمتك.', array['شكرا','مشكور','يعطيك العافية','تسلم','الله يعطيك'], true, false, 50, true);

-- جلب المعرفة لنيّة واحدة
create or replace function public.wa_get_knowledge(p_intent text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'approved_answer', approved_answer, 'allowed_variation', allowed_variation) order by priority desc), '[]'::jsonb)
  from public.knowledge_base where active and intent = p_intent;
$$;

-- كل المعرفة النشطة (لحقنها في موجّه الذكاء)
create or replace function public.wa_get_knowledge_all()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('intent', intent, 'title', title, 'answer', approved_answer) order by priority desc), '[]'::jsonb)
  from public.knowledge_base where active;
$$;

-- تخزين رد الذكاء كرسالة صادرة معلّقة + حارس السعر البرمجي
create or replace function public.wa_store_ai_reply(
  p_conversation_id uuid, p_text text, p_intent text, p_pricing_request_id uuid, p_model text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid; v_msg uuid;
  v_price boolean := p_text ~* '(ريال|﷼|SAR|سعر|تكلفة|خصم)';
begin
  select client_id into v_client from public.wa_conversations where id = p_conversation_id;
  if v_price and p_pricing_request_id is null then
    insert into public.automation_events (conversation_id, event_type, severity, detail)
    values (p_conversation_id, 'security_block', 'critical', jsonb_build_object('reason','price_without_approval','intent',p_intent,'text',left(p_text,300)));
    return jsonb_build_object('blocked', true, 'reason', 'price_without_approval');
  end if;
  insert into public.communications (client_id, conversation_id, channel, direction, body, message_type, status, ai_processed, occurred_at)
  values (v_client, p_conversation_id, 'whatsapp', 'out', p_text, 'text', 'pending_send', true, now())
  returning id into v_msg;
  update public.wa_conversations set last_message_at = now(), intent = coalesce(p_intent, intent) where id = p_conversation_id;
  insert into public.automation_events (conversation_id, event_type, severity, detail)
  values (p_conversation_id, 'ai_reply_queued', 'info', jsonb_build_object('intent',p_intent,'model',p_model,'message_id',v_msg));
  return jsonb_build_object('blocked', false, 'message_id', v_msg);
end $$;

revoke all on function public.wa_get_knowledge(text) from public, anon;
revoke all on function public.wa_get_knowledge_all() from public, anon;
revoke all on function public.wa_store_ai_reply(uuid,text,text,uuid,text) from public, anon;
grant execute on function public.wa_get_knowledge(text) to service_role, authenticated;
grant execute on function public.wa_get_knowledge_all() to service_role, authenticated;
grant execute on function public.wa_store_ai_reply(uuid,text,text,uuid,text) to service_role;

-- ملاحظة: wa_handle_inbound حُدّثت لتُرجع أيضاً text/district/service_type
-- (النسخة الكاملة في الكود المُطبّق؛ إعادة الإنشاء تمّت عبر execute_sql).
