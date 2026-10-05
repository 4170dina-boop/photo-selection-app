// לשון פנייה (נקבה/זכר) לטקסטים שפונים ישירות לצופה בגלריה ולמיילים ללקוח/ה.
//
// מקורות המין:
// - הלקוח/ה הראשי/ת (הבעלים): galleries.client_gender, נקבע ע"י הצלמת בטופס
//   יצירה/עריכה של הגלריה. ברירת מחדל 'f' (כולל כשהעמודה עוד לא קיימת ב-DB).
// - אורחים (בני משפחה/חברים): gallery_participants.gender, נבחר במסך ההצטרפות.
//   null = לא ידוע (אורחים ותיקים מלפני השדה, או מיגרציה שלא רצה) - ואז
//   משתמשים בצורה ניטרלית עם לוכסן ("בחר/י").
//
// פונקציות טהורות (חוץ מ-fetch*/save* בסוף, שמקבלות לקוח supabase כפרמטר),
// כך שאפשר לייבא את הקובץ גם בדפדפן.

export type Gender = 'f' | 'm';
// null = לא ידוע -> צורה ניטרלית
export type ViewerGender = Gender | null;

export const DEFAULT_CLIENT_GENDER: Gender = 'f';

export function normalizeGender(value: unknown): Gender | null {
  return value === 'f' || value === 'm' ? value : null;
}

// אימות שדה מגוף בקשה (POST/PATCH של גלריה, הצטרפות אורח/ת). חסר/null =
// "לא נשלח" (value: null) - אלא אם required.
export function parseGenderInput(
  value: unknown,
  options: { required?: boolean } = {}
): { ok: true; value: Gender | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return options.required ? { ok: false, error: 'צריך לבחור לשון פנייה' } : { ok: true, value: null };
  }
  const gender = normalizeGender(value);
  if (!gender) return { ok: false, error: 'לשון הפנייה לא תקינה' };
  return { ok: true, value: gender };
}

const FINAL_TO_REGULAR: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

// צורה ניטרלית אוטומטית מתוך שתי הצורות, מילה מול מילה:
// 'בחרי'/'בחר' -> 'בחר/י', 'מחוברת'/'מחובר' -> 'מחובר/ת',
// 'ברוכה הבאה'/'ברוך הבא' -> 'ברוך/ה הבא/ה', 'נסי'/'נסה' -> 'נסה/נסי'.
export function slashForm(f: string, m: string): string {
  if (f === m) return f;
  const fWords = f.split(' ');
  const mWords = m.split(' ');
  if (fWords.length !== mWords.length) return `${m}/${f}`;
  return mWords
    .map((mw, i) => {
      const fw = fWords[i];
      if (fw === mw) return mw;
      // אות סופית בזכר ('ברוך') היא אות רגילה בנקבה ('ברוכה')
      const mwStem = mw.slice(0, -1) + (FINAL_TO_REGULAR[mw.slice(-1)] ?? mw.slice(-1));
      if (fw.startsWith(mwStem) && fw.length > mw.length) return `${mw}/${fw.slice(mw.length)}`;
      return `${mw}/${fw}`;
    })
    .join(' ');
}

// בחירת צורה לפי מין. n (ניטרלי) אופציונלי - בלעדיו נגזר אוטומטית (slashForm)
// כשמדובר במחרוזות, אחרת נופלים לצורת הנקבה.
export function g<T>(gender: ViewerGender | undefined, forms: { f: T; m: T; n?: T }): T {
  if (gender === 'f') return forms.f;
  if (gender === 'm') return forms.m;
  if (forms.n !== undefined) return forms.n;
  if (typeof forms.f === 'string' && typeof forms.m === 'string') {
    return slashForm(forms.f, forms.m) as unknown as T;
  }
  return forms.f;
}

// קיצור לטקסט: gt(gender, 'סמני', 'סמן') / gt(gender, 'בואי', 'בוא', 'בואו')
export function gt(gender: ViewerGender | undefined, f: string, m: string, n?: string): string {
  return g(gender, { f, m, n });
}

// מי הצופה בגלריה: הבעלים -> מין הלקוח/ה מהגלריה; אורח/ת -> מה שבחר/ה בהצטרפות.
export function resolveViewerGender(params: {
  isOwner: boolean;
  clientGender: Gender | null | undefined;
  participantGender: Gender | null | undefined;
}): ViewerGender {
  if (params.isOwner) return normalizeGender(params.clientGender) ?? DEFAULT_CLIENT_GENDER;
  return normalizeGender(params.participantGender);
}

// ---------- גישה ל-DB (best-effort כשהעמודות עוד לא קיימות) ----------

// עמודה חסרה: 42703 מ-Postgres (select), PGRST204 מ-PostgREST (insert/update
// עם עמודה שלא בסכמה).
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const message = error.message ?? '';
  return /column .* does not exist/i.test(message) || /could not find the .* column/i.test(message);
}

// טיפוס מינימלי במכוון - מתאים גם ל-service_role client וגם ללקוח השרת עם session.
interface SupabaseLike {
  from: (table: string) => any;
}

// galleries.client_gender - כל שגיאה (כולל עמודה חסרה) = ברירת המחדל 'f'.
export async function fetchClientGender(supabase: SupabaseLike, galleryId: string): Promise<Gender> {
  try {
    const { data, error } = await supabase.from('galleries').select('client_gender').eq('id', galleryId).maybeSingle();
    if (error) return DEFAULT_CLIENT_GENDER;
    return normalizeGender(data?.client_gender) ?? DEFAULT_CLIENT_GENDER;
  } catch {
    return DEFAULT_CLIENT_GENDER;
  }
}

// gallery_participants.gender לכל המשתתפים בגלריה - כשל = מפה ריקה (הכל "לא ידוע").
export async function fetchParticipantGenders(supabase: SupabaseLike, galleryId: string): Promise<Map<string, Gender>> {
  const result = new Map<string, Gender>();
  try {
    const { data, error } = await supabase.from('gallery_participants').select('id, gender').eq('gallery_id', galleryId);
    if (error) return result;
    for (const row of (data ?? []) as { id: string; gender: unknown }[]) {
      const gender = normalizeGender(row.gender);
      if (gender) result.set(row.id, gender);
    }
  } catch {
    // בכוונה שקט - ראו הערה למעלה
  }
  return result;
}

// שמירת galleries.client_gender כעדכון נפרד אחרי השמירה הראשית - כך שעמודה
// חסרה (מיגרציה שלא רצה) לא מפילה יצירה/עריכה של גלריה.
export async function saveClientGender(
  supabase: SupabaseLike,
  galleryId: string,
  gender: Gender
): Promise<'ok' | 'missing-column' | 'error'> {
  try {
    const { error } = await supabase.from('galleries').update({ client_gender: gender }).eq('id', galleryId);
    if (!error) return 'ok';
    return isMissingColumnError(error) ? 'missing-column' : 'error';
  } catch {
    return 'error';
  }
}
