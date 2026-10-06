import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  checkManualEmailCooldown,
  priorSendTimes,
  DAY_MS,
  MANUAL_EMAIL_COOLDOWN_SECONDS,
  MANUAL_EMAIL_DAILY_CAP,
  type CooldownDecision,
  type ManualEmailType,
} from './manualEmailCooldown';

// קריאה/כתיבה של יומן השליחות הידניות (טבלת manual_email_sends, ראו
// supabase/schema.sql). רץ עם ה-session של הצלמת - ה-RLS מגביל לשורות שלה,
// ומאפשר לה רק select + insert (לא update/delete), כדי שלא תוכל למחוק שורות
// ו"לאפס" את המגבלה דרך ה-REST.
//
// אטומיות: לא "בודקות ואז רושמות" (שתי לחיצות מקבילות היו עוברות שתיהן את
// הבדיקה) אלא "משריינות ואז בודקות": קודם מכניסות שורה (או שורה לכל נמען),
// ורק אז קוראות את היומן - שליחה מקבילה רואה את השריון (priorSendTimes).
// אם הבדיקה חוסמת או שהשליחה נכשלה - השריון נמחק (עם service_role, כי לצלמת
// אין הרשאת delete), כך שכישלון לא "שורף" את הלחיצה הבאה.
//
// עמידות: אם המיגרציה עוד לא הורצה (הטבלה לא קיימת) או שיש שגיאת שאילתה
// אחרת - לא חוסמות שליחה. supabase-js לא זורק על שגיאת DB אלא מחזיר
// { error }, אז בודקות אותו במפורש. נופלות ל-fallbackSentAts (עמודה קיימת כמו
// galleries.last_reminder_sent_at / shoots.confirmation_sent_at) אם יש, כדי
// שלפחות ה-60 שניות יחולו, ומדלגות על הרישום.

export type ManualEmailTarget = { galleryId: string } | { shootId: string };

function targetColumn(target: ManualEmailTarget): ['gallery_id' | 'shoot_id', string] {
  return 'galleryId' in target ? ['gallery_id', target.galleryId] : ['shoot_id', target.shootId];
}

// מחיקת שריונות בלבד (לפי id שהוחזר מה-insert שלנו) - service_role כי ה-RLS
// לא נותן לצלמת delete על הטבלה.
let adminClient: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!adminClient) adminClient = createClient(url, key);
  return adminClient;
}

export interface ManualEmailReservation {
  decision: CooldownDecision;
  // ids של השורות ששוריינו (ריק אם נחסם, או אם היומן לא זמין)
  reservationIds: string[];
}

export interface ReserveOptions {
  fallbackSentAts?: (string | null | undefined)[];
  // כמה מיילים (שורות) לשריין - הזמנה מחדש: אחד לכל נמען, כדי שהמכסה היומית
  // תספור נמענים ולא לחיצות.
  count?: number;
  // 'target' (ברירת מחדל) = לפי גלריה/צילום; 'photographer' = לכל הצלמת
  // (אישור צילום חדש, ראו SHOOT_CONFIRMATION_DAILY_CAP).
  scope?: 'target' | 'photographer';
  cooldownSeconds?: number;
  dailyCap?: number;
  now?: Date;
}

export async function reserveManualEmailSend(
  supabase: SupabaseClient,
  photographerId: string,
  target: ManualEmailTarget,
  emailType: ManualEmailType,
  options: ReserveOptions = {}
): Promise<ManualEmailReservation> {
  const now = options.now ?? new Date();
  const count = Math.max(1, Math.floor(options.count ?? 1));
  const cooldownSeconds = options.cooldownSeconds ?? MANUAL_EMAIL_COOLDOWN_SECONDS;
  const dailyCap = options.dailyCap ?? MANUAL_EMAIL_DAILY_CAP;
  const fallback = (): ManualEmailReservation => ({
    decision: checkManualEmailCooldown(options.fallbackSentAts ?? [], now, cooldownSeconds, dailyCap, count),
    reservationIds: [],
  });
  const [column, id] = targetColumn(target);

  try {
    // 1) RPC אטומי (reserve_manual_email_send, supabase/schema.sql): נועל
    // pg_advisory_xact_lock לפי הצלמת, מכניס את השריון עם clock_timestamp()
    // ומחזיר את שורות החלון - כך שליחה מקבילה ממתינה לנעילה ורואה את השריון
    // שכבר נשמר. 2) אם הפונקציה עוד לא קיימת (מיגרציה חלקית) - insert ואז
    // select רגילים: עדיין משריינות לפני הבדיקה, רק עם חלון מרוץ זעיר.
    let reservationIds: string[] = [];
    let windowRows: { id: string; sent_at: string }[] | null = null;

    const { data: rpcRows, error: rpcError } = await supabase.rpc('reserve_manual_email_send', {
      p_photographer_id: photographerId,
      p_gallery_id: column === 'gallery_id' ? id : null,
      p_shoot_id: column === 'shoot_id' ? id : null,
      p_email_type: emailType,
      p_count: count,
      p_scope: options.scope === 'photographer' ? 'photographer' : 'target',
    });

    if (!rpcError && Array.isArray(rpcRows)) {
      const typed = rpcRows as { r_id: string; r_sent_at: string; r_own: boolean }[];
      reservationIds = typed.filter((r) => r.r_own).map((r) => r.r_id);
      windowRows = typed.map((r) => ({ id: r.r_id, sent_at: r.r_sent_at }));
      if (reservationIds.length === 0) return fallback();
    } else {
      const rows = Array.from({ length: count }, () => ({
        photographer_id: photographerId,
        [column]: id,
        email_type: emailType,
      }));
      const { data: inserted, error: insertError } = await supabase
        .from('manual_email_sends')
        .insert(rows)
        .select('id, sent_at');
      if (insertError || !inserted?.length) return fallback();
      reservationIds = (inserted as { id: string }[]).map((r) => r.id);

      let query = supabase
        .from('manual_email_sends')
        .select('id, sent_at')
        .eq('email_type', emailType)
        .gte('sent_at', new Date(now.getTime() - DAY_MS).toISOString());
      query = options.scope === 'photographer' ? query.eq('photographer_id', photographerId) : query.eq(column, id);
      const { data, error } = await query;
      if (error) {
        // השריון כבר נרשם - נשאר כרישום של השליחה; ההחלטה לפי ה-fallback
        return { ...fallback(), reservationIds };
      }
      windowRows = (data ?? []) as { id: string; sent_at: string }[];
    }

    const prior = priorSendTimes(windowRows ?? [], reservationIds);
    const decision = checkManualEmailCooldown(prior, now, cooldownSeconds, dailyCap, count);
    if (!decision.allowed) {
      await releaseManualEmailReservations(reservationIds);
      return { decision, reservationIds: [] };
    }
    return { decision, reservationIds };
  } catch {
    return fallback();
  }
}

// מוחקות שריונות של שליחות שלא יצאו בפועל (כישלון שליחה / נמענים שנכשלו).
export async function releaseManualEmailReservations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = getAdmin();
  if (!admin) return;
  try {
    const { error } = await admin.from('manual_email_sends').delete().in('id', ids);
    if (error) console.error('releaseManualEmailReservations failed', error.message);
  } catch {
    // לא מפילות את הבקשה בגלל ניקוי שריון - השורה פשוט נספרת (שמרני)
  }
}

export function cooldownResponse(decision: Extract<CooldownDecision, { allowed: false }>) {
  return NextResponse.json(
    { error: decision.message, cooldown: true, retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
  );
}
