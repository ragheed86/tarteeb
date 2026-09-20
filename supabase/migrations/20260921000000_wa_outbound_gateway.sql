-- ============================================================
--  WhatsApp AI — WF-06 بوابة الإرسال (event-driven)
--  رسالة صادرة معلّقة (out/pending_send) → pg_net → webhook n8n «WhatsApp
--  Outbound Gateway» (PgLJx619fXG0ixaz) → WhatsApp Cloud API → wa_mark_sent.
--  طُبّق حيّاً عبر execute_sql؛ هذا الملف للمزامنة repo↔DB.
-- ============================================================

create extension if not exists pg_net;

-- تعليم الرسالة الصادرة كمُرسَلة/فاشلة + حفظ معرّف مزوّد واتساب
create or replace function public.wa_mark_sent(p_message_id uuid, p_provider_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.communications
     set status = coalesce(nullif(p_status,''), 'sent'),
         wa_message_id = coalesce(wa_message_id, nullif(p_provider_id,''))
   where id = p_message_id;
  return jsonb_build_object('ok', true, 'message_id', p_message_id, 'status', coalesce(nullif(p_status,''),'sent'));
end $$;
revoke all on function public.wa_mark_sent(uuid,text,text) from public, anon;
grant execute on function public.wa_mark_sent(uuid,text,text) to service_role;

-- مُطلِق بوابة الإرسال لحظة إنشاء/تحديث رسالة صادرة معلّقة
create or replace function public.wa_dispatch_outbound()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_to text;
begin
  if new.direction = 'out' and new.status = 'pending_send'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending_send') then
    select regexp_replace(coalesce(c.wa_id, c.phone, ''), '[^0-9]', '', 'g')
      into v_to from public.wa_conversations c where c.id = new.conversation_id;
    if v_to is not null and v_to <> '' then
      perform net.http_post(
        url := 'https://tarteeb.app.n8n.cloud/webhook/wa-outbound',
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object('message_id', new.id, 'to', v_to, 'text', new.body)
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wa_dispatch_outbound on public.communications;
create trigger trg_wa_dispatch_outbound
  after insert or update of status on public.communications
  for each row execute function public.wa_dispatch_outbound();
