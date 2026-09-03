import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// קריאת AI יקרה משמעותית מ"עיצוב הגלריה" (הרבה תמונות, לא רק טקסט קצר) -
// תקרה יומית נמוכה יותר, ראו supabase/schema.sql.
const DAILY_LIMIT = 5;
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

  const { data: gallery } = await supabaseAdmin.from('galleries').select('photographer_id').eq('id', galleryId).single();
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { data: photographer } = await supabaseAdmin
    .from('photographers')
    .select('id')
    .eq('id', gallery.photographer_id)
    .single();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  // הבדיקה וה"תפיסה" של המכסה היומית (reserve_ai_picks_quota, ראו
  // supabase/schema.sql) קורות יחד באופן אטומי ב-DB *לפני* קריאות ה-AI ועיבוד
  // התמונות למטה - לא רק בדיקה מוקדמת עם כתיבה מאוחרת בסוף כמו קודם - כדי
  // ששתי בקשות מקבילות (למשל הבעלים ובן משפחה שלוחצים "עזרי לי לבחור" כמעט
  // יחד) לא יוכלו שתיהן לעבור את הבדיקה על סמך אותו usedToday ולצרוך שתי
  // הרצות AI בתשלום כשהמונה בפועל מתקדם ב-1 בלבד. לא "מחזירים" מכסה שנתפסה
  // אם ההרצה עצמה נכשלת/לא מוצאת כלום אחר כך - מכסה יומית רכה בלבד, וגם הקוד
  // הקודם לא זיכה הרצה חוזרת בחינם על כשל.
  const { data: quotaReserved, error: quotaError } = await supabaseAdmin.rpc('reserve_ai_picks_quota', {
    p_photographer_id: photographer.id,
    p_daily_limit: DAILY_LIMIT,
  });

  if (quotaError) {
    return NextResponse.json({ error: 'שגיאה בבדיקת המכסה היומית, נסו שוב' }, { status: 500 });
  }

  if (!quotaReserved) {
    return NextResponse.json({ error: `הגעתם למגבלה היומית (${DAILY_LIMIT} הרצות) - נסו שוב מחר` }, { status: 429 });
  }

  const { data: photos } = await supabaseAdmin.from('photos').select('id, file_path, thumbnail_path').eq('gallery_id', galleryId);
  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: 'אין עדיין תמונות בגלריה' }, { status: 400 });
  }

  const { data: existingMarks } = await supabaseAdmin
    .from('selections')
    .select('photo_id')
    .eq('gallery_id', galleryId)
    .eq('participant_id', session.participantId);
  const alreadyMarkedIds = new Set((existingMarks ?? []).map((s) => s.photo_id));

  const candidates = evenSample(
    photos.filter((p) => !alreadyMarkedIds.has(p.id)),
    MAX_PHOTOS_TO_ANALYZE
  );

  if (candidates.length === 0) {
    return NextResponse.json({ error: 'כל התמונות כבר מסומנות' }, { status: 400 });
  }

  // מכינים תמונות קטנות (base64) לכל מועמדת - best-effort, תמונה שנכשלת
  // בהורדה/עיבוד פשוט לא נכללת בניתוח במקום להפיל את כל הבקשה.
  const prepared = await Promise.all(
    candidates.map(async (photo) => {
      try {
        const path = photo.thumbnail_path ?? photo.file_path;
        const { data: file } = await supabaseAdmin.storage.from('gallery-photos').download(path);
        if (!file) return null;
        const buffer = Buffer.from(await file.arrayBuffer());
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

      const aiData: any = await aiResponse.json();
      const rawText: string = aiData?.content?.[0]?.text ?? '';
      try {
        const indices = extractJsonArray(rawText);
        indices.forEach((i) => {
          if (batch[i]) pickedIds.add(batch[i].photoId);
        });
      } catch {
        // בכוונה שקט - באטש בודד שנכשל לא מפיל את שאר ההרצה
      }
    })
  );

  if (pickedIds.size > 0) {
    await supabaseAdmin.from('selections').upsert(
      Array.from(pickedIds).map((photoId) => ({
        gallery_id: galleryId,
        photo_id: photoId,
        participant_id: session.participantId,
        status: 'maybe' as const,
      })),
      { onConflict: 'gallery_id,photo_id,participant_id' }
    );
  }

  // המכסה כבר נתפסה אטומית למעלה (reserve_ai_picks_quota) לפני קריאות ה-AI -
  // אין צורך בעדכון מונה נוסף כאן.
  return NextResponse.json({
    pickedCount: pickedIds.size,
    analyzedCount: ready.length,
    totalPhotos: photos.length,
    pickedPhotoIds: Array.from(pickedIds),
  });
}
