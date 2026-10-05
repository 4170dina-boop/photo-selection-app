// סימוני "שולם"/"בעריכה"/"נמסר" ברשימת הגלריות (app/api/galleries/[id]/toggle-*).
// במקור ה-route פשוט הפך את הערך השמור - לחיצה כפולה (או שתי לשוניות פתוחות)
// הפכה אותו פעמיים וחזרה למצב ההתחלתי בלי שהצלמת ידעה. עכשיו הדשבורד שולח
// את הערך הרצוי ({ value: boolean }) וה-route קובע אותו; בלי גוף (קריאות
// ישנות) - נשאר ה-toggle הישן, לתאימות לאחור.

// ערך רצוי מגוף הבקשה, או undefined אם לא נשלח ערך בוליאני.
export function parseToggleValue(body: unknown): boolean | undefined {
  if (body && typeof body === 'object' && typeof (body as { value?: unknown }).value === 'boolean') {
    return (body as { value: boolean }).value;
  }
  return undefined;
}

// הערך החדש לשמירה: desired=true שומר את חותמת הזמן הקיימת אם כבר מסומן
// (כדי לא "לאפס" את התאריך המקורי), desired=false מנקה, undefined הופך.
export function nextToggleTimestamp(current: string | null, desired: boolean | undefined, nowIso: string): string | null {
  const on = desired ?? !current;
  return on ? current ?? nowIso : null;
}

// קריאת הגוף בלי להפיל את הבקשה כשאין גוף בכלל (קריאות ישנות שולחות POST ריק).
export async function readToggleValue(req: Request): Promise<boolean | undefined> {
  try {
    return parseToggleValue(await req.json());
  } catch {
    return undefined;
  }
}
