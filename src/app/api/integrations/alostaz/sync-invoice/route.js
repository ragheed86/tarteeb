import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../../_auth';
import { pushInvoiceToAlostaz } from '@/lib/alostazAdmin';

// يُستدعى بعد إنشاء/تعديل فاتورة أو إضافة دفعة (أفضل جهد، لا يوقف حفظ الفاتورة عند الفشل)
export async function POST(request) {
  const session = await requirePermission(request, 'invoices');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  const invoiceId = body.invoice_id;
  if (!invoiceId) return apiError('invoice_id مطلوب', 400);

  try {
    const result = await pushInvoiceToAlostaz(invoiceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'تعذّرت المزامنة مع alostaz.io' }, { status: 500 });
  }
}
