import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { clearDaftraSettings } from '@/lib/daftraAdmin';

export async function POST(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;
  try {
    await clearDaftraSettings();
    return NextResponse.json({ connected: false });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر فصل الربط' }, { status: 500 });
  }
}
