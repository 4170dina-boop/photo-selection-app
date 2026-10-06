import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, uploadBuffer } from '@/lib/r2';
import { buildPhotoKey, gridThumbKey, isAllowedLogoUrl, mapWithConcurrency, previewKey, remainingPhotoQuota } from '@/lib/uploadPolicy';
import { createGridThumbnail, createWatermarkedPreview } from '@/lib/watermark';
import { computeDHash } from '@/lib/phash';
import { isMissingColumnError } from '@/lib/gender';
import {
  SAMPLE_CLIENT_NAME,
  sampleExpiryIso,
  sampleOriginalFilename,
  samplePackage,
  samplePhotoCount,
} from '@/lib/sampleGallery';
import { renderSampleJpeg } from '@/lib/sampleGalleryImages';

// "✨ גלריית דוגמה" מאשף הפתיחה (app/dashboard/welcome/page.tsx): גלריה אמיתית
// לכל דבר שהלקוחה בה היא הצלמת עצמה (המייל שלה), עם ~8 תמונות דמה (גרדיאנט +
// מספר, lib/sampleGallery.ts) - כדי שתוכל לפתוח את הקישור "כלקוחה" ולראות בדיוק
// מה הלקוחות שלה יראו, לפני שהעלתה תמונה אמיתית אחת.
//
// התמונות עוברות את אותו צינור כמו העלאה רגילה: מקור ב-R2 בתיקיית הגלריה
// (buildPhotoKey), שורת photos (enforce_photo_limit אוכף את המכסה), ואז סימן
// מים + תמונת גריד (lib/watermark.ts) לאותם keys ש-/process כותב (previewKey /
// gridThumbKey). ההבדל היחיד: המקור נוצר כאן בשרת במקום להגיע מהדפדפן.
//
// מגבלות חשבון חינמי: trg_enforce_active_gallery_limit דוחה את הגלריה אם כבר
// יש גלריה פעילה (402, כמו ביצירה רגילה), וכמות התמונות נחתכת לפי המכסה.
// galleries.is_sample נכתב בעדכון נפרד (best-effort - עמודה חסרה לא מפילה
// את היצירה). protect_internal_gallery_columns לא נוגע ב-is_sample - זו לא
// עמודה פנימית, הצלמת רשאית לסמן אותה בעצמה.
//
// לא נשלח מייל הזמנה - הקישור והקוד מוחזרים ומוצגים באשף.

export const maxDuration = 60;

function generateAccessCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function rollback(label: string, op: PromiseLike<{ error: unknown }>) {
  const { error } = await op;
  if (error) console.error(`[POST /api/galleries/sample] rollback failed (${label}):`, error);
}

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ error: 'לחשבון אין כתובת מייל' }, { status: 400 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name, watermark_text, logo_url, is_unlimited, default_base_price, default_extra_photo_price')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  let client: { id: string } | null = null;
  let accessCode = '';
  for (let attempt = 0; attempt < 5 && !client; attempt++) {
    accessCode = generateAccessCode();
    const { data, error } = await supabase
      .from('clients')
      .insert({ photographer_id: photographer.id, full_name: SAMPLE_CLIENT_NAME, email: user.email, access_code: accessCode })
      .select('id')
      .single();
    if (!error) client = data;
    else if (error.code !== '23505') return NextResponse.json({ error: 'יצירת גלריית הדוגמה נכשלה' }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: 'לא הצלחנו ליצור קוד גישה ייחודי, נסי שוב' }, { status: 500 });
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .insert({
      photographer_id: photographer.id,
      client_id: client.id,
      status: 'sent',
      reminder_days: 0,
      sent_at: new Date().toISOString(),
      expires_at: sampleExpiryIso(Date.now()),
    })
    .select('id')
    .single();

  if (galleryError || !gallery) {
    await rollback('client', supabase.from('clients').delete().eq('id', client.id));
    if (galleryError?.message?.includes('LIMIT_ACTIVE_GALLERY')) {
      return NextResponse.json(
        { error: 'חשבון חינמי מוגבל לגלריה פעילה אחת - השלימי או מחקי את הגלריה הפעילה כדי ליצור גלריית דוגמה' },
        { status: 402 }
      );
    }
    return NextResponse.json({ error: 'יצירת גלריית הדוגמה נכשלה' }, { status: 500 });
  }

  // מכאן כל כישלון מוחק את הגלריה (packages/participants/photos ב-CASCADE),
  // את הלקוחה ואת מה שכבר עלה ל-R2.
  const uploadedKeys: string[] = [];
  async function fail(message: string, status = 500) {
    if (uploadedKeys.length > 0) {
      try {
        await deleteObjects(uploadedKeys);
      } catch (err) {
        console.error('[POST /api/galleries/sample] ניקוי R2 נכשל:', err);
      }
    }
    await rollback('gallery', supabase.from('galleries').delete().eq('id', gallery!.id));
    await rollback('client', supabase.from('clients').delete().eq('id', client!.id));
    return NextResponse.json({ error: message }, { status });
  }

  const { error: packageError } = await supabase.from('packages').insert({ gallery_id: gallery.id, ...samplePackage(photographer) });
  if (packageError) return fail('יצירת החבילה נכשלה');

  const { data: owner, error: ownerError } = await supabase
    .from('gallery_participants')
    .insert({ gallery_id: gallery.id, display_name: photographer.business_name || SAMPLE_CLIENT_NAME, is_owner: true })
    .select('id')
    .single();
  if (ownerError || !owner) return fail('יצירת גלריית הדוגמה נכשלה');

  const { error: ownerLinkError } = await supabase.from('galleries').update({ owner_participant_id: owner.id }).eq('id', gallery.id);
  if (ownerLinkError) return fail('יצירת גלריית הדוגמה נכשלה');

  // best-effort - בלי העמודה הגלריה פשוט לא תסומן "דוגמה" ברשימות
  const { error: sampleFlagError } = await supabase.from('galleries').update({ is_sample: true }).eq('id', gallery.id);
  if (sampleFlagError && !isMissingColumnError(sampleFlagError)) {
    console.error('[POST /api/galleries/sample] סימון is_sample נכשל:', sampleFlagError);
  }

  // לוגו כסימן מים - אותו כלל SSRF כמו ב-/process
  let logoBuffer: Buffer | null = null;
  if (isAllowedLogoUrl(photographer.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    try {
      const res = await fetch(photographer.logo_url, { redirect: 'error' });
      if (res.ok) logoBuffer = Buffer.from(await res.arrayBuffer());
    } catch {
      logoBuffer = null;
    }
  }
  const watermarkText = photographer.watermark_text?.trim() || photographer.business_name;

  // גלריה חדשה = 0 תמונות, אבל עוברים דרך אותה פונקציית מכסה כמו ההעלאה
  const count = samplePhotoCount(remainingPhotoQuota(0, !!photographer.is_unlimited));
  const numbers = Array.from({ length: count }, (_, i) => i + 1);

  let limitHit = false;
  const results = await mapWithConcurrency(numbers, 3, async (n) => {
    try {
      const original = await renderSampleJpeg(n);
      const filePath = buildPhotoKey(gallery.id, crypto.randomUUID(), 'jpg');
      await uploadBuffer(filePath, original, 'image/jpeg');
      uploadedKeys.push(filePath);

      const { data: photo, error: insertError } = await supabase
        .from('photos')
        .insert({ gallery_id: gallery.id, file_path: filePath, thumbnail_path: null, original_filename: sampleOriginalFilename(n) })
        .select('id')
        .single();
      if (insertError || !photo) {
        if (insertError?.message?.includes('LIMIT_PHOTOS')) limitHit = true;
        return false;
      }

      // קודם שני האובייקטים, ורק אז thumbnail_path - אותו סדר כמו /process
      const preview = await createWatermarkedPreview(original, watermarkText, logoBuffer);
      const grid = await createGridThumbnail(preview);
      const thumbPath = previewKey(gallery.id, photo.id);
      const gridPath = gridThumbKey(thumbPath) as string;
      await Promise.all([uploadBuffer(gridPath, grid, 'image/jpeg'), uploadBuffer(thumbPath, preview, 'image/jpeg')]);
      uploadedKeys.push(thumbPath, gridPath);

      const { error: updateError } = await supabase.from('photos').update({ thumbnail_path: thumbPath }).eq('id', photo.id);
      if (updateError) return false;

      // best-effort כמו ב-/process
      try {
        const phash = await computeDHash(grid);
        await supabase.from('photos').update({ phash }).eq('id', photo.id);
      } catch {
        // בכוונה שקט
      }
      return true;
    } catch (err) {
      console.error('[POST /api/galleries/sample] תמונת דוגמה נכשלה:', n, err);
      return false;
    }
  });

  const created = results.filter(Boolean).length;
  if (created === 0 && count > 0) {
    return fail(limitHit ? 'הגעת למכסת התמונות בחשבון החינמי' : 'יצירת תמונות הדוגמה נכשלה', limitHit ? 403 : 500);
  }

  return NextResponse.json({ galleryId: gallery.id, accessCode, photoCount: created });
}
