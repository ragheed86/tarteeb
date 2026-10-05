import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { pushAllClientsToDaftra } from '@/lib/daftraAdmin';

// مزامنة دفعية — افتراضياً العملاء غير المُزامَنين فقط؛ force=true يعيد الكل
export async function POST(request) {
  const session = await requirePermission(request, 'clients');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  try {
    const result = await pushAllClientsToDaftra({ force: !!body.force });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّرت المزامنة الدفعية مع دفترة' }, { status: 500 });
  }
}
