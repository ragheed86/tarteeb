import { NextResponse } from 'next/server';
import { getAccessForUser, getSessionUser } from '../_auth';

export async function GET(request) {
  const session = await getSessionUser(request);
  if (session.response) return session.response;
  try {
    const access = await getAccessForUser(session.user);
    return NextResponse.json({ access });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر تحميل الصلاحيات' }, { status: 500 });
  }
}
