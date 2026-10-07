import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { clearAlostazSettings } from '@/lib/alostazAdmin';

export async function POST(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;
  try {
    await clearAlostazSettings();
    return NextResponse.json({ connected: false });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر فصل الربط' }, { status: 500 });
  }
}
