import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';
import { downloadToBuffer } from '@/lib/r2';
import { hasWatermarkedThumbnail } from '@/lib/uploadPolicy';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { isMissingFunctionError } from '@/lib/rpcErrors';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// קריאת AI יקרה משמעותית מ"עיצוב הגלריה" (הרבה תמונות, לא רק טקסט קצר) -
// תקרה יומית נמוכה יותר, ראו supabase/schema.sql.
const DAILY_LIMIT = 5;
// תקרה יומית נוספת לכל גלריה (reserve_gallery_ai_picks_quota, supabase/schema.sql) -
// כדי שגלריה אחת לא תשרוף את כל המכסה של הצלמת (ואת שאר הלקוחות שלה) ביום אחד.
// המספר מופיע גם בטקסט GALLERY_LIMIT_ERROR (טקסט קבוע - lib/i18n/serverErrors.ts
// ממפה לפיו לתרגום), אז משנים את שניהם יחד.
const GALLERY_DAILY_LIMIT = 3;
const GALLERY_LIMIT_ERROR = 'הבחירה בעזרת AI כבר הופעלה 3 פעמים היום בגלריה הזו - אפשר לנסות שוב מחר';
const OWNER_ONLY_ERROR = 'הבחירה בעזרת AI זמינה רק ללקוחה הראשית - אפשר להמשיך לסמן תמונות כרגיל';
// מגבילים כמה תמונות מנתחים בכל הרצה - גם כדי לא לחרוג מזמן הריצה של
// הפונקציה בענן, וגם כי עלות/זמן גדלים ליניארית עם כמות התמונות. בגלריה
// גדולה יותר, דוגמים באופן אחיד על פני כל הגלריה (לא רק ה-N הראשונות),
// כדי שההצעות ייצגו את כל האירוע.
const MAX_PHOTOS_TO_ANALYZE = 60;
const BATCH_SIZE = 15;
const ANALYSIS_MAX_DIMENSION = 500;

const SYSTEM_PROMPT = `את/ה עוזר/ת לצלמת מקצועית לסמן נקודת פתיחה מהירה בגלריית בחירת תמונות ללקוחה.
תקבל/י כמה תמונות ממוספרות (0, 1, 2...). בחר/י את התמונות הכי טובות מבחינה טכנית -
חדות, עיניים פקוחות, הבעות פנים טבעיות/מחייכות, קומפוזיציה טובה, לא תנועה מטושטשת.
החזר/י אך ורק מערך JSON של המספרים שבחרת, בלי שום טקסט נוסף, בלי markdown, לדוגמה: [0,3,7]
בחר/י בערך 20%-30% מהתמונות שקיבלת, לא יותר.`;

function extractJsonArray(text: string): number[] {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('not an array');
  return parsed.filter((n) => typeof n === 'number');
}

// דגימה אחידה על פני כל הרשימה (לא רק ה-N הראשונות) - כדי שההצעות ייצגו
// את כל האירוע, לא רק את מה שהועלה קודם.
function evenSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  const writable = await checkGalleryWritable(supabaseAdmin, galleryId);
  if (!writable.ok) {
    return NextResponse.json({ error: writable.error }, { status: writable.status });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'שירות ה-AI לא מוגדר עדיין' }, { status: 503 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('photographer_id, owner_participant_id')
    .eq('id', galleryId)
    .single();
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // רק הבעלים - כל קריאה עולה כסף לצלמת (Anthropic), וכל מי שמחזיק בקוד
  // הגישה המשותף יכול להצטרף כאורח/ת ולהפעיל את זה שוב ושוב. בממשק הכפתור
  // מוסתר לאורחים (app/gallery/[id]/page.tsx).
  if (session.participantId !== gallery.owner_participant_id) {
    return NextResponse.json({ error: OWNER_ONLY_ERROR }, { status: 403 });
  }

  const { data: photographer } = await supabaseAdmin
    .from('photographers')
    .select('id')
    .eq('id', gallery.photographer_id)
    .single();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  // רק תמונות שהלקוחה בפועל רואה (עם thumbnail מעובד) - ראו app/api/gallery/[id]/route.ts.
  // עם pagination (lib/fetchAllPages.ts) - בגלריה של יותר מ-1000 תמונות הדגימה
  // הייתה מגיעה רק מה-1000 הראשונות.
  let allPhotos: { id: string; file_path: string; thumbnail_path: string | null }[];
  try {
    allPhotos = await fetchAllPages<any>((from, to) =>
      supabaseAdmin
        .from('photos')
        .select('id, file_path, thumbnail_path')
        .eq('gallery_id', galleryId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error('[ai-picks] טעינת התמונות נכשלה:', err);
    return NextResponse.json({ error: 'הניתוח לא הצליח כרגע - ההרצה לא נספרה, נסי שוב בעוד כמה דקות' }, { status: 502 });
  }
  const photos = allPhotos.filter(hasWatermarkedThumbnail);
  if (photos.length === 0) {
    return NextResponse.json({ error: 'אין עדיין תמונות בגלריה' }, { status: 400 });
  }

  const { data: existingMarks } = await supabaseAdmin
    .from('selections')
    .select('photo_id')
    .eq('gallery_id', galleryId)
    .eq('participant_id', session.participantId);
  const alreadyMarkedIds = new Set((existingMarks ?? []).map((s) => s.photo_id));

  // תמונות מתנה (lib/gifts.ts) כבר כלולות - לא מציעים אותן (route הבחירה גם
  // חוסם סימון שלהן), אחרת ההרצה הייתה "מבזבזת" הצעות על תמונות שלא נספרות.
  const giftIds = new Set((await fetchGiftPhotos(supabaseAdmin, [galleryId])).map((g) => g.id));

  const candidates = evenSample(
    photos.filter((p) => !alreadyMarkedIds.has(p.id) && !giftIds.has(p.id)),
    MAX_PHOTOS_TO_ANALYZE
  );

  if (candidates.length === 0) {
    return NextResponse.json({ error: 'כל התמונות כבר מסומנות' }, { status: 400 });
  }

  // הבדיקה וה"תפיסה" של המכסה היומית (reserve_ai_picks_quota, ראו
  // supabase/schema.sql) קורות יחד באופן אטומי ב-DB *לפני* קריאות ה-AI ועיבוד
  // התמונות למטה - כדי ששתי בקשות מקבילות (למשל הבעלים ובן משפחה שלוחצים
  // "עזרי לי לבחור" כמעט יחד) לא יוכלו שתיהן לעבור את הבדיקה על סמך אותו
  // usedToday. נתפסת רק אחרי הבדיקות הזולות למעלה ("אין תמונות"/"הכל מסומן"),
  // כדי שבקשה שממילא לא תקרא ל-AI לא תשרוף הרצה. אם אף קריאת AI לא הצליחה -
  // ההרצה מוחזרת (release_ai_picks_quota למטה).
  //
  // קודם המכסה של הגלריה (GALLERY_DAILY_LIMIT), ואז של הצלמת. אם הפונקציה של
  // הגלריה עוד לא קיימת (מיגרציה שלא רצה) - ממשיכים רק עם המכסה של הצלמת.
  const { data: galleryQuotaReserved, error: galleryQuotaError } = await supabaseAdmin.rpc('reserve_gallery_ai_picks_quota', {
    p_gallery_id: galleryId,
    p_daily_limit: GALLERY_DAILY_LIMIT,
  });
  let galleryQuotaHeld = false;
  if (galleryQuotaError) {
    if (!isMissingFunctionError(galleryQuotaError)) {
      console.error('[ai-picks] reserve_gallery_ai_picks_quota נכשל:', galleryQuotaError);
      return NextResponse.json({ error: 'שגיאה בבדיקת המכסה היומית, נסו שוב' }, { status: 500 });
    }
    console.warn('[ai-picks] reserve_gallery_ai_picks_quota חסרה - רק המכסה של הצלמת נאכפת עד שהמיגרציה תרוץ');
  } else if (!galleryQuotaReserved) {
    return NextResponse.json({ error: GALLERY_LIMIT_ERROR }, { status: 429 });
  } else {
    galleryQuotaHeld = true;
  }

  // החזרת המכסה של הגלריה (best-effort) - כשהמכסה של הצלמת לא נתפסה, או
  // כשאף קריאת AI לא הצליחה.
  const releaseGalleryQuota = async () => {
    if (!galleryQuotaHeld) return;
    const { error } = await supabaseAdmin.rpc('release_gallery_ai_picks_quota', { p_gallery_id: galleryId });
    if (error) console.error('[ai-picks] החזרת המכסה של הגלריה נכשלה:', error);
  };

  const { data: quotaReserved, error: quotaError } = await supabaseAdmin.rpc('reserve_ai_picks_quota', {
    p_photographer_id: photographer.id,
    p_daily_limit: DAILY_LIMIT,
  });

  if (quotaError) {
    await releaseGalleryQuota();
    return NextResponse.json({ error: 'שגיאה בבדיקת המכסה היומית, נסו שוב' }, { status: 500 });
  }

  if (!quotaReserved) {
    await releaseGalleryQuota();
    return NextResponse.json({ error: `הגעתם למגבלה היומית (${DAILY_LIMIT} הרצות) - נסו שוב מחר` }, { status: 429 });
  }

  // מכינים תמונות קטנות (base64) לכל מועמדת - best-effort, תמונה שנכשלת
  // בהורדה/עיבוד פשוט לא נכללת בניתוח במקום להפיל את כל הבקשה.
  const prepared = await Promise.all(
    candidates.map(async (photo) => {
      try {
        const buffer = await downloadToBuffer(photo.thumbnail_path as string);
        if (!buffer) return null;
        const small = await sharp(buffer)
          .rotate()
          .resize({ width: ANALYSIS_MAX_DIMENSION, height: ANALYSIS_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 55 })
          .toBuffer();
        return { photoId: photo.id, base64: small.toString('base64') };
      } catch {
        return null;
      }
    })
  );
  const ready = prepared.filter((p): p is { photoId: string; base64: string } => p !== null);

  const batches: { photoId: string; base64: string }[][] = [];
  for (let i = 0; i < ready.length; i += BATCH_SIZE) {
    batches.push(ready.slice(i, i + BATCH_SIZE));
  }

  const pickedIds = new Set<string>();
  let succeededBatches = 0;

  await Promise.all(
    batches.map(async (batch) => {
      const content = [
        ...batch.map((p) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.base64 } })),
        { type: 'text', text: `יש ${batch.length} תמונות ממוספרות 0 עד ${batch.length - 1} לפי הסדר שקיבלת אותן.` },
      ];

      let aiResponse: Response;
      try {
        aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY as string,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content }],
          }),
        });
      } catch {
        return;
      }
      if (!aiResponse.ok) return;

      try {
        const aiData: any = await aiResponse.json();
        const rawText: string = aiData?.content?.[0]?.text ?? '';
        const indices = extractJsonArray(rawText);
        succeededBatches++;
        indices.forEach((i) => {
          if (batch[i]) pickedIds.add(batch[i].photoId);
        });
      } catch {
        // בכוונה שקט - באטש בודד שנכשל לא מפיל את שאר ההרצה
      }
    })
  );

  // אף באטש לא קיבל תשובה תקינה מה-AI (שירות לא זמין, כל ההורדות נכשלו וכו') -
  // הלקוחה לא קיבלה כלום, אז מחזירים את ההרצה שנתפסה למכסה היומית. הזיכוי
  // אטומי ב-DB ומוגבל לאותו יום (release_ai_picks_quota, supabase/schema.sql) -
  // אם היום התחלף בינתיים, המונה כבר אופס ממילא ולא יורד מתחת ל-0.
  // best-effort: אם הפונקציה עוד לא קיימת (מיגרציה לא רצה) פשוט לא מזכים.
  if (succeededBatches === 0) {
    const { error: releaseError } = await supabaseAdmin.rpc('release_ai_picks_quota', {
      p_photographer_id: photographer.id,
    });
    if (releaseError) console.error('[ai-picks] החזרת המכסה נכשלה:', releaseError);
    await releaseGalleryQuota();
    return NextResponse.json({ error: 'הניתוח לא הצליח כרגע - ההרצה לא נספרה, נסי שוב בעוד כמה דקות' }, { status: 502 });
  }

  if (pickedIds.size > 0) {
    // קריאות ה-AI לוקחות זמן - בינתיים הבעלים אולי לחצה "סיימתי לבחור" או
    // שהתוקף פג. בודקים שוב רגע לפני הכתיבה, אותה בדיקה כמו בתחילת הבקשה.
    const stillWritable = await checkGalleryWritable(supabaseAdmin, galleryId);
    if (!stillWritable.ok) {
      return NextResponse.json({ error: stillWritable.error }, { status: stillWritable.status });
    }

    // insert בלבד (ignoreDuplicates): סימון שהלקוחה עשתה בעצמה בזמן הניתוח
    // (למשל "נבחר") לא נדרס ל"אולי" ע"י הצעת ה-AI.
    const { error: insertError } = await supabaseAdmin.from('selections').upsert(
      Array.from(pickedIds).map((photoId) => ({
        gallery_id: galleryId,
        photo_id: photoId,
        participant_id: session.participantId,
        status: 'maybe' as const,
      })),
      { onConflict: 'gallery_id,photo_id,participant_id', ignoreDuplicates: true }
    );
    if (insertError) {
      console.error('[ai-picks] שמירת ההצעות נכשלה:', insertError);
      return NextResponse.json({ error: 'שמירת ההצעות נכשלה, נסי שוב' }, { status: 500 });
    }
  }

  return NextResponse.json({
    pickedCount: pickedIds.size,
    analyzedCount: ready.length,
    totalPhotos: photos.length,
    pickedPhotoIds: Array.from(pickedIds),
  });
}
