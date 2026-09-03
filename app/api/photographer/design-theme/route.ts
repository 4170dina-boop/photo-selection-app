import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// service_role רק בשביל עדכון מונה השימוש היומי (theme_gen_count/date) -
// לא חלק מ-PATCH /api/photographer הרגיל, כי זו ספירה פנימית שלא צריכה
// לעבור דרך אימות/ולידציה של שינוי פרופיל.
const supabaseAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DAILY_LIMIT = 10;
const DESCRIPTION_MAX_LENGTH = 300;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const SYSTEM_PROMPT = `את/ה מעצב/ת פלטת צבעים לגלריית תמונות של צלמת מקצועית, לפי תיאור קצר במילים שהצלמת נותנת.
החזר/י אך ורק אובייקט JSON תקין בפורמט הזה, בלי שום טקסט נוסף, בלי markdown:
{"bg":"#RRGGBB","panel":"#RRGGBB","text":"#RRGGBB","accent":"#RRGGBB"}

חוקים:
- bg הוא צבע הרקע הראשי של הדף.
- panel הוא צבע כרטיסים/פאנלים על גבי הרקע - חייב ניגודיות ברורה מ-bg (לא זהה, לא כמעט זהה).
- text הוא צבע הטקסט הראשי - חייב ניגודיות גבוהה וקריאה מול bg (אם bg כהה, text בהיר; אם bg בהיר, text כהה).
- accent הוא צבע הדגשה (כפתורים, בחירה) - צבע חי ומובחן מה-bg וה-panel.
- שמור/י על טעם עיצובי אלגנטי ומקצועי, מתאים לצילום אירועים/פורטרטים.`;

// כדי שהתשובה תמיד תהיה JSON תקין בפורמט קבוע, בלי לסמוך על שיפוט חופשי
// של המודל - זה מה שמאפשר לנו לבדוק/לדחות תשובות לא תקינות בביטחון.
function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  let body: { description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return NextResponse.json({ error: 'צריך לתאר איך רוצים שהגלריה תיראה' }, { status: 400 });
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return NextResponse.json({ error: `התיאור ארוך מדי (מקסימום ${DESCRIPTION_MAX_LENGTH} תווים)` }, { status: 400 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'שירות עיצוב ה-AI לא מוגדר עדיין - חסר מפתח API' }, { status: 503 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  // מגבלה יומית - בעיקר רשת ביטחון נגד שימוש חוזר בלתי צפוי, לא כי העלות
  // בפועל גבוהה (ראו README - שבריר אגורה לכל קריאה). הבדיקה וה"תפיסה" של
  // המכסה (reserve_theme_gen_quota, ראו supabase/schema.sql) קורות יחד באופן
  // אטומי ב-DB *לפני* קריאת ה-AI - לא רק בדיקה מוקדמת עם כתיבה מאוחרת בסוף
  // כמו קודם - כדי ששתי בקשות מקבילות (שתי לשוניות פתוחות באותו רגע) לא
  // יוכלו שתיהן לעבור את הבדיקה על סמך אותו usedToday ולצרוך שתי קריאות AI
  // בתשלום כשהמונה בפועל מתקדם ב-1 בלבד. לא "מחזירים" מכסה שנתפסה אם קריאת
  // ה-AI עצמה נכשלת אחר כך - מכסה יומית רכה בלבד, וגם הקוד הקודם לא זיכה
  // ניסיון חוזר בחינם על כשל.
  const { data: quotaReserved, error: quotaError } = await supabaseAdmin.rpc('reserve_theme_gen_quota', {
    p_photographer_id: photographer.id,
    p_daily_limit: DAILY_LIMIT,
  });

  if (quotaError) {
    return NextResponse.json({ error: 'שגיאה בבדיקת המכסה היומית, נסי שוב' }, { status: 500 });
  }

  if (!quotaReserved) {
    return NextResponse.json({ error: `הגעת למגבלה היומית (${DAILY_LIMIT} ניסיונות) - נסי שוב מחר` }, { status: 429 });
  }

  let aiResponse: Response;
  try {
    aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: description }],
      }),
    });
  } catch {
    return NextResponse.json({ error: 'קריאה לשירות העיצוב נכשלה, נסי שוב' }, { status: 502 });
  }

  if (!aiResponse.ok) {
    return NextResponse.json({ error: 'קריאה לשירות העיצוב נכשלה, נסי שוב' }, { status: 502 });
  }

  const aiData: any = await aiResponse.json();
  const rawText: string = aiData?.content?.[0]?.text ?? '';

  let parsed: any;
  try {
    parsed = extractJson(rawText);
  } catch {
    return NextResponse.json({ error: 'התשובה מה-AI לא הייתה תקינה, נסי לתאר אחרת' }, { status: 502 });
  }

  if (!parsed || !HEX_RE.test(parsed.bg) || !HEX_RE.test(parsed.panel) || !HEX_RE.test(parsed.text) || !HEX_RE.test(parsed.accent)) {
    return NextResponse.json({ error: 'התשובה מה-AI לא הייתה תקינה, נסי לתאר אחרת' }, { status: 502 });
  }

  const theme = { bg: parsed.bg, panel: parsed.panel, text: parsed.text, accent: parsed.accent };

  // המכסה כבר נתפסה אטומית למעלה (reserve_theme_gen_quota) לפני קריאת ה-AI -
  // אין צורך בעדכון מונה נוסף כאן.
  return NextResponse.json({ theme });
}
