import { NextResponse } from 'next/server';
import { adminLockedToUserId, requireAdmin } from '@/lib/requireAdmin';

// רק כדי שהתפריט בדשבורד ידע אם להציג את כפתור "ניהול צלמות" - ההרשאה
// בפועל נאכפת בכל route תחת app/api/admin/* בנפרד (lib/requireAdmin.ts).
// למנהלת בלבד מוחזרים גם ה-user id שלה והאם ADMIN_USER_ID מוגדר - דף הניהול
// מציג לפיהם המלצה לנעול את הניהול לחשבון שלה.
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ isAdmin: false });
  return NextResponse.json({ isAdmin: true, userId: admin.id, lockedToUserId: adminLockedToUserId() });
}
