-- ============================================================
--  ترتيب · WhatsApp AI Automation — Phase 2 (Data / State model)
--  يوسّع CRM الحالي (لا نظام موازٍ):
--    • clients      = نموذج العميل/الـLead (REUSE + EXTEND)
--    • communications = مخزن الرسائل (REUSE + EXTEND، كان فارغاً)
--  ويضيف طبقة محادثة/وسائط/معرفة/تسعير/حجز/سجلّات جديدة عند الحاجة فقط.
--  RLS: نفس نمط has_permission('<key>') + سياسات permission_* للـauthenticated.
--  n8n يكتب عبر service_role (يتجاوز RLS).
-- ============================================================

-- ---------- 1) توسيع مصادر العميل (Lead Source) ----------
alter type public.client_source add value if not exists 'google';
alter type public.client_source add value if not exists 'website';
alter type public.client_source add value if not exists 'snapchat';
alter type public.client_source add value if not exists 'campaign';
alter type public.client_source add value if not exists 'unknown';

-- ---------- 2) توسيع جدول العملاء ----------
alter table public.clients
  add column if not exists service_type text,          -- kitchen|closet|bedroom|storage|office|laundry|other
  add column if not exists wa_id        text,          -- معرّف واتساب (رقم مُطبّع) لبحث idempotent
  add column if not exists last_wa_at   timestamptz;   -- آخر تفاعل واتساب

create index if not exists idx_clients_wa_id on public.clients(wa_id);
create index if not exists idx_clients_phone on public.clients(phone);

-- ============================================================
--  3) wa_conversations — كيان المحادثة + آلة الحالة (FSM)
-- ============================================================
create table if not exists public.wa_conversations (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references public.clients(id) on delete set null,
  wa_id             text,
  phone             text,
  state             text not null default 'AI_ACTIVE'
                    check (state in ('AI_ACTIVE','COLLECTING_INFO','WAITING_MEDIA',
                                     'WAITING_PRICING','HUMAN_TAKEOVER','WAITING_BOOKING_APPROVAL')),
  automation_paused boolean not null default false,
  pipeline_stage    text not null default 'NEW'
                    check (pipeline_stage in ('NEW','COLLECTING_INFO','READY_FOR_REVIEW','NEEDS_PRICING',
                                              'QUOTE_SENT','BOOKING_PENDING','BOOKED','COMPLETED')),
  intent            text,
  summary           text,                              -- ملخص AI للسياق
  assigned_to       uuid,                              -- app_user_access.user_id عند الاستلام البشري
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_wa_conv_client on public.wa_conversations(client_id);
create index if not exists idx_wa_conv_waid   on public.wa_conversations(wa_id);
create index if not exists idx_wa_conv_state  on public.wa_conversations(state);

-- ============================================================
--  4) communications — توسعة لتصبح مخزن رسائل واتساب موحّد
-- ============================================================
alter table public.communications
  add column if not exists conversation_id uuid references public.wa_conversations(id) on delete cascade,
  add column if not exists wa_message_id   text,       -- مفتاح idempotency من واتساب
  add column if not exists message_type    text not null default 'text'
                          check (message_type in ('text','voice','image','video','document','location','system')),
  add column if not exists status          text,       -- received|sent|delivered|read|failed
  add column if not exists media_id        text,       -- WhatsApp media id
  add column if not exists media_url       text,
  add column if not exists media_path      text,       -- مسار داخل bucket whatsapp-media
  add column if not exists transcript      text,       -- تفريغ الصوت
  add column if not exists ai_processed    boolean not null default false,
  add column if not exists raw             jsonb;

-- idempotency: لا تُعالَج نفس رسالة واتساب مرتين
create unique index if not exists uq_comm_wa_message_id
  on public.communications(wa_message_id) where wa_message_id is not null;
create index if not exists idx_comm_conversation on public.communications(conversation_id);

-- ============================================================
--  5) wa_media — الوسائط الواردة (مرتبطة بالمحادثة/الرسالة)
-- ============================================================
create table if not exists public.wa_media (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.wa_conversations(id) on delete cascade,
  message_id      uuid references public.communications(id) on delete cascade,
  wa_media_id     text,
  media_type      text check (media_type in ('image','video','audio','document')),
  storage_path    text,
  file_url        text,
  mime_type       text,
  transcript      text,                                -- للصوت
  created_at      timestamptz not null default now()
);
create index if not exists idx_wa_media_conv on public.wa_media(conversation_id);
create index if not exists idx_wa_media_msg  on public.wa_media(message_id);

-- ============================================================
--  6) wa_media_analysis — مخرجات تحليل Vision (منظّمة، بلا سعر)
--     media_id = null  → تحليل مُجمّع (Combined batch) يمثّل المكان كاملاً
-- ============================================================
create table if not exists public.wa_media_analysis (
  id                       uuid primary key default gen_random_uuid(),
  conversation_id          uuid references public.wa_conversations(id) on delete cascade,
  media_id                 uuid references public.wa_media(id) on delete cascade,
  is_combined              boolean not null default false,
  space_type               text,
  clutter_level            text check (clutter_level  in ('low','medium','high','very_high')),
  items_quantity           text check (items_quantity in ('low','medium','high','very_high')),
  organizing_complexity    text,
  visible_storage          text,
  potential_organizer_need boolean,
  image_quality            text,
  enough_for_pricing_review boolean,
  observations             jsonb not null default '[]'::jsonb,
  video_summary            text,
  model                    text,
  raw                      jsonb,
  created_at               timestamptz not null default now()
);
create index if not exists idx_wa_analysis_conv on public.wa_media_analysis(conversation_id);

-- ============================================================
--  7) knowledge_base — مصدر الحقيقة لردود الخدمة (Supabase لا Sheets)
-- ============================================================
create table if not exists public.knowledge_base (
  id                uuid primary key default gen_random_uuid(),
  intent            text,
  category          text,
  title             text,
  approved_answer   text not null,
  keywords          text[] not null default '{}',
  allowed_variation boolean not null default true,     -- يسمح لـAI بتحسين الصياغة فقط
  requires_approval boolean not null default false,
  priority          integer not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_kb_intent on public.knowledge_base(intent) where active;

-- ============================================================
--  8) pricing_requests — يوقف AI حتى اعتماد بشري (Ragheed/Dalal)
-- ============================================================
create table if not exists public.pricing_requests (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.wa_conversations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete set null,
  service_type     text,
  district         text,
  status           text not null default 'NEEDS_PRICING'
                   check (status in ('NEEDS_PRICING','PRICED','SENT','CANCELLED')),
  media_summary    text,
  ai_context       jsonb,                              -- Relevant context فقط (لا تاريخ كامل)
  approved_price   numeric,
  currency         text not null default 'SAR',
  notes            text,
  approved_by      uuid,                               -- app_user_access.user_id
  approved_by_email text,
  approved_at      timestamptz,
  sent_at          timestamptz,
  quote_id         uuid references public.quotes(id) on delete set null,  -- ربط اختياري مستقبلي
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_pricing_conv   on public.pricing_requests(conversation_id);
create index if not exists idx_pricing_status on public.pricing_requests(status);

-- ============================================================
--  9) booking_requests — لا تأكيد موعد بلا موافقة بشرية
-- ============================================================
create table if not exists public.booking_requests (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid references public.wa_conversations(id) on delete cascade,
  client_id            uuid references public.clients(id) on delete set null,
  requested_date       date,
  requested_time       text,
  requested_datetime   timestamptz,
  status               text not null default 'WAITING_APPROVAL'
                       check (status in ('WAITING_APPROVAL','CONFIRMED','REJECTED','RESCHEDULE_SUGGESTED')),
  calendar_availability text,                          -- free|busy|unknown (قراءة Google Calendar)
  calendar_event_id    text,                           -- بعد التأكيد فقط
  suggested_datetime   timestamptz,                    -- عند اقتراح وقت بديل
  decided_by           uuid,
  decided_by_email     text,
  decided_at           timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_booking_conv   on public.booking_requests(conversation_id);
create index if not exists idx_booking_status on public.booking_requests(status);

-- ============================================================
--  10) ai_logs — تسجيل استدعاءات النموذج (بلا secrets)
-- ============================================================
create table if not exists public.ai_logs (
  id              uuid primary key default gen_random_uuid(),
  workflow        text,
  conversation_id uuid,
  message_id      text,
  prompt_name     text,        -- intent_classifier|media_analyzer|customer_service_reply|...
  model           text,
  intent          text,
  latency_ms      integer,
  tokens_input    integer,
  tokens_output   integer,
  status          text,        -- ok|error|blocked
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_logs_conv on public.ai_logs(conversation_id);
create index if not exists idx_ai_logs_created on public.ai_logs(created_at desc);

-- ============================================================
--  11) automation_events — أحداث الأتمتة/الأمان (Guardrail/dedup/تسليم)
-- ============================================================
create table if not exists public.automation_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  event_type      text,        -- security_block|outbound_sent|outbound_failed|dedup_skipped|escalation|state_change
  severity        text not null default 'info',   -- info|warning|critical
  detail          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_autoevents_type on public.automation_events(event_type);
create index if not exists idx_autoevents_created on public.automation_events(created_at desc);

-- ============================================================
--  12) triggers: updated_at
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['wa_conversations','knowledge_base','pricing_requests','booking_requests']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ============================================================
--  13) RLS + سياسات permission_* (نفس نمط باقي الجداول)
--     عام: has_permission('whatsapp')
--     اعتماد السعر:  update/delete على pricing_requests  → 'whatsapp_pricing'
--     اعتماد الحجز:  update/delete على booking_requests  → 'whatsapp_booking'
-- ============================================================
do $$
declare t text;
begin
  -- جداول الوصول العام للواتساب
  foreach t in array array['wa_conversations','wa_media','wa_media_analysis',
                           'knowledge_base','ai_logs','automation_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists permission_select on public.%I', t);
    execute format('drop policy if exists permission_insert on public.%I', t);
    execute format('drop policy if exists permission_update on public.%I', t);
    execute format('drop policy if exists permission_delete on public.%I', t);
    execute format('create policy permission_select on public.%I for select to authenticated using ((select public.has_permission(''whatsapp'')))', t);
    execute format('create policy permission_insert on public.%I for insert to authenticated with check ((select public.has_permission(''whatsapp'')))', t);
    execute format('create policy permission_update on public.%I for update to authenticated using ((select public.has_permission(''whatsapp''))) with check ((select public.has_permission(''whatsapp'')))', t);
    execute format('create policy permission_delete on public.%I for delete to authenticated using ((select public.has_permission(''whatsapp'')))', t);
  end loop;
end $$;

-- pricing_requests: قراءة/إدراج whatsapp، تعديل/حذف whatsapp_pricing
alter table public.pricing_requests enable row level security;
drop policy if exists permission_select on public.pricing_requests;
drop policy if exists permission_insert on public.pricing_requests;
drop policy if exists permission_update on public.pricing_requests;
drop policy if exists permission_delete on public.pricing_requests;
create policy permission_select on public.pricing_requests for select to authenticated using ((select public.has_permission('whatsapp')));
create policy permission_insert on public.pricing_requests for insert to authenticated with check ((select public.has_permission('whatsapp')));
create policy permission_update on public.pricing_requests for update to authenticated using ((select public.has_permission('whatsapp_pricing'))) with check ((select public.has_permission('whatsapp_pricing')));
create policy permission_delete on public.pricing_requests for delete to authenticated using ((select public.has_permission('whatsapp_pricing')));

-- booking_requests: قراءة/إدراج whatsapp، تعديل/حذف whatsapp_booking
alter table public.booking_requests enable row level security;
drop policy if exists permission_select on public.booking_requests;
drop policy if exists permission_insert on public.booking_requests;
drop policy if exists permission_update on public.booking_requests;
drop policy if exists permission_delete on public.booking_requests;
create policy permission_select on public.booking_requests for select to authenticated using ((select public.has_permission('whatsapp')));
create policy permission_insert on public.booking_requests for insert to authenticated with check ((select public.has_permission('whatsapp')));
create policy permission_update on public.booking_requests for update to authenticated using ((select public.has_permission('whatsapp_booking'))) with check ((select public.has_permission('whatsapp_booking')));
create policy permission_delete on public.booking_requests for delete to authenticated using ((select public.has_permission('whatsapp_booking')));

-- ============================================================
--  14) Storage: bucket خاص للوسائط الواردة + سياسات whatsapp
-- ============================================================
insert into storage.buckets (id, name, public)
values ('whatsapp-media','whatsapp-media', false)
on conflict (id) do nothing;

drop policy if exists whatsapp_media_select on storage.objects;
drop policy if exists whatsapp_media_insert on storage.objects;
drop policy if exists whatsapp_media_update on storage.objects;
drop policy if exists whatsapp_media_delete on storage.objects;
create policy whatsapp_media_select on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-media' and (select public.has_permission('whatsapp')));
create policy whatsapp_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'whatsapp-media' and (select public.has_permission('whatsapp')));
create policy whatsapp_media_update on storage.objects for update to authenticated
  using (bucket_id = 'whatsapp-media' and (select public.has_permission('whatsapp')))
  with check (bucket_id = 'whatsapp-media' and (select public.has_permission('whatsapp')));
create policy whatsapp_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'whatsapp-media' and (select public.has_permission('whatsapp')));
