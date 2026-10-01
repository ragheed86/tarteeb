// واتساب: صندوق الوارد، مراجعة الأسعار، موافقة الحجوزات
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { clearSupabaseReadCache, supabase } from '../supabase';

// ---------- واتساب · صندوق الوارد (WhatsApp Inbox) ----------
// المحادثات مع بيانات العميل ومعاينة آخر رسالة (استعلام واحد عبر التضمين)
export async function getWaConversations() {
  const { data, error } = await supabase
    .from('wa_conversations')
    .select('id,state,pipeline_stage,automation_paused,intent,summary,phone,wa_id,contact_name,last_message_at,last_inbound_at,created_at,client:client_id(id,name,phone,district,status,service_type,source,in_crm),messages:communications(body,direction,message_type,occurred_at)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('occurred_at', { ascending: false, referencedTable: 'messages' })
    .limit(1, { referencedTable: 'messages' });
  if (error) throw error;
  return data || [];
}

// رسائل محادثة واحدة مرتّبة زمنياً
export async function getWaMessages(conversationId) {
  const { data, error } = await supabase
    .from('communications')
    .select('id,direction,body,message_type,media_id,media_url,media_path,transcript,status,occurred_at,wa_message_id')
    .eq('conversation_id', conversationId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// آخر طلب تسعير وحجز للمحادثة (لبطاقة السياق)
export async function getWaConversationContext(conversationId) {
  const [pricing, booking] = await Promise.all([
    supabase.from('pricing_requests').select('id,status,approved_price,currency,service_type,created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
    supabase.from('booking_requests').select('id,status,requested_date,requested_time,created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
  ]);
  return { pricing: pricing || null, booking: booking || null };
}

// ---------- واتساب · مراجعة واعتماد الأسعار (Pricing Review) ----------
export async function getPricingRequests(status = 'NEEDS_PRICING') {
  const { data, error } = await supabase
    .from('pricing_requests')
    .select('id,status,service_type,district,media_summary,notes,approved_price,currency,created_at,conversation_id,client:client_id(id,name,phone,district,source,status),conversation:conversation_id(id,summary,state,pipeline_stage)')
    .eq('status', status)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// اعتماد السعر وإرساله (محصور بصلاحية whatsapp_pricing عبر دالة قاعدة البيانات)
export async function approvePricing(pricingRequestId, price, notes) {
  const { data, error } = await supabase.rpc('wa_approve_pricing', {
    p_pricing_request_id: pricingRequestId,
    p_price: price,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data; // { ok, message_id, reply } أو { error }
}

// ---------- واتساب · موافقة الحجوزات (Booking Approval) ----------
export async function getBookingRequests() {
  const { data, error } = await supabase
    .from('booking_requests')
    .select('id,status,requested_date,requested_time,requested_datetime,suggested_datetime,notes,created_at,conversation_id,client:client_id(id,name,phone,district,status)')
    .in('status', ['WAITING_APPROVAL', 'RESCHEDULE_SUGGESTED'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// قرار الحجز: confirm | reject | reschedule (محكوم بصلاحية whatsapp_booking)
export async function decideBooking(bookingId, decision, { suggested = null, notes = null, calendarEventId = null } = {}) {
  const { data, error } = await supabase.rpc('wa_decide_booking', {
    p_booking_id: bookingId,
    p_decision: decision,
    p_calendar_event_id: calendarEventId,
    p_suggested: suggested,
    p_notes: notes,
  });
  if (error) throw error;
  return data;
}

// نقل جهة واتساب إلى الـCRM بتصنيف (عميل محتمل=lead / عميل حالي=active ...) — محكوم بصلاحية whatsapp
export async function addConversationToCrm(conversationId, status = 'lead') {
  const { data, error } = await supabase.rpc('wa_conversation_to_crm', {
    p_conversation_id: conversationId,
    p_status: status,
  });
  if (error) throw error;
  clearSupabaseReadCache('clients');
  return data; // { ok, client_id, name, status } أو { error }
}

// إرسال رد يدوي من الصندوق (رغد/دلال) — يمرّ عبر بوابة الإرسال WF-06؛ يوقف الأتمتة تلقائياً
export async function sendManualReply(conversationId, text) {
  const { data, error } = await supabase.rpc('wa_send_manual_reply', {
    p_conversation_id: conversationId,
    p_text: text,
  });
  if (error) throw error;
  return data; // { ok, message_id } أو { error }
}

// الاستلام البشري / العودة للأتمتة (Human Takeover)
export async function setConversationTakeover(conversationId, paused) {
  const { data, error } = await supabase
    .from('wa_conversations')
    .update({ automation_paused: paused, state: paused ? 'HUMAN_TAKEOVER' : 'AI_ACTIVE' })
    .eq('id', conversationId)
    .select('id,state,automation_paused')
    .single();
  if (error) throw error;
  return data;
}
