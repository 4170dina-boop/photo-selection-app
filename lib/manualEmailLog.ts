import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkManualEmailCooldown, DAY_MS, type CooldownDecision, type ManualEmailType } from './manualEmailCooldown';

// קריאה/כתיבה של יומן השליחות הידניות (טבלת manual_email_sends, ראו
// supabase/schema.sql). רץ עם ה-session של הצלמת - ה-RLS מגביל לשורות שלה.
//
// עמידות: אם המיגרציה עוד לא הורצה (הטבלה לא קיימת) או שיש שגיאת שאילתה
// אחרת - לא חוסמות שליחה. נופלות ל-fallbackSentAts (עמודה קיימת כמו
// galleries.last_reminder_sent_at / shoots.confirmation_sent_at) אם יש, כדי
// שלפחות ה-60 שניות יחולו, ומדלגות על הרישום.

export type ManualEmailTarget = { galleryId: string } | { shootId: string };

function targetColumn(target: ManualEmailTarget): ['gallery_id' | 'shoot_id', string] {
  return 'galleryId' in target ? ['gallery_id', target.galleryId] : ['shoot_id', target.shootId];
}

export async function getManualEmailCooldown(
  supabase: SupabaseClient,
  target: ManualEmailTarget,
  emailType: ManualEmailType,
  fallbackSentAts: (string | null | undefined)[] = [],
  now: Date = new Date()
): Promise<CooldownDecision> {
  const [column, id] = targetColumn(target);
  try {
    const { data, error } = await supabase
      .from('manual_email_sends')
      .select('sent_at')
      .eq(column, id)
      .eq('email_type', emailType)
      .gte('sent_at', new Date(now.getTime() - DAY_MS).toISOString());

    if (error) {
      return checkManualEmailCooldown(fallbackSentAts, now);
    }
    return checkManualEmailCooldown((data ?? []).map((r: { sent_at: string }) => r.sent_at), now);
  } catch {
    return checkManualEmailCooldown(fallbackSentAts, now);
  }
}

// נרשם רק אחרי שליחה מוצלחת - שליחה שנכשלה לא "שורפת" את הלחיצה הבאה.
export async function recordManualEmailSend(
  supabase: SupabaseClient,
  photographerId: string,
  target: ManualEmailTarget,
  emailType: ManualEmailType
): Promise<void> {
  const [column, id] = targetColumn(target);
  try {
    await supabase
      .from('manual_email_sends')
      .insert({ photographer_id: photographerId, [column]: id, email_type: emailType });
  } catch {
    // טבלה חסרה/שגיאה - לא מפילות את הבקשה בגלל רישום
  }
}

export function cooldownResponse(decision: Extract<CooldownDecision, { allowed: false }>) {
  return NextResponse.json(
    { error: decision.message, cooldown: true, retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
  );
}
