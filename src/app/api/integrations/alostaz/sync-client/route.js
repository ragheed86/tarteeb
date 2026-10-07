import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../../_auth';
import { pushClientToAlostaz } from '@/lib/alostazAdmin';

// يُستدعى من واجهة العملاء بعد كل إنشاء/تعديل (أفضل جهد، لا يوقف حفظ العميل عند الفشل)
export async function POST(request) {
  const session = await requirePermission(request, 'clients');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  const clientId = body.client_id;
  if (!clientId) return apiError('client_id مطلوب', 400);

  try {
    const result = await pushClientToAlostaz(clientId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'تعذّرت المزامنة مع alostaz.io' }, { status: 500 });
  }
}
