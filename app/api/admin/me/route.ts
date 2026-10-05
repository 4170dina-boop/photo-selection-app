import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';

// רק כדי שהתפריט בדשבורד ידע אם להציג את כפתור "ניהול צלמות" - ההרשאה
// בפועל נאכפת בכל route תחת app/api/admin/* בנפרד (lib/requireAdmin.ts).
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await requireAdmin();
  return NextResponse.json({ isAdmin: !!admin });
}
