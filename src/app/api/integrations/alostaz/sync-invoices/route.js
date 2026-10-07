import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { pushAllInvoicesToAlostaz } from '@/lib/alostazAdmin';

// مزامنة دفعية — افتراضياً الفواتير غير المُزامَنة فقط؛ force=true يعيد الكل
export async function POST(request) {
  const session = await requirePermission(request, 'invoices');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  try {
    const result = await pushAllInvoicesToAlostaz({ force: !!body.force });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّرت المزامنة الدفعية مع alostaz.io' }, { status: 500 });
  }
}
