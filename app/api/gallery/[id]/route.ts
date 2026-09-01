import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { BLUR_THRESHOLD } from '@/lib/sharpness';

// service_role - נשאר בצד שרת בלבד. כל הגישה של הלקוחה לנתוני הגלריה
// עוברת דרך ה-API הזה (ולא דרך anon key ישירות מהדפדפן), כי אין policy
// שמאפשרת גישת anon/לקוח ישירה ל-photos/selections/packages - ראו schema.sql.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // שעה - מספיק לצפייה בגלריה בישיבה אחת

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, owner_participant_id, clients(full_name), photographers(brand_color, business_name, logo_url, custom_theme)')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  // "ממתין לפתיחה" (sent) -> "בבחירה" (in_progress) ברגע שהלקוחה בפועל פותחת
  // את הגלריה (קוד גישה כבר אומת ב-verify-access לפני שמגיעים לכאן) - בלי זה
  // הלוח של הצלמת ממשיך להראות "ממתין לפתיחה" לנצח, גם אחרי שהלקוחה כבר
  // בפנים ובוחרת תמונות. לא נוגעים בסטטוסים אחרים (completed/expired).
  if (gallery.status === 'sent') {
    await supabaseAdmin
      .from('galleries')
      .update({ status: 'in_progress', last_activity_at: new Date().toISOString() })
      .eq('id', galleryId);
    gallery.status = 'in_progress';
  }

  // שיתוף גלריה משפחתי: קוד הגישה כבר אומת, אבל עדיין לא ידוע מי בפועל
  // נכנס/ת (הבעלים הרשומה, או בן משפחה אחר) - ראו app/api/gallery/[id]/identify/route.ts.
  // מחזירים את שם הבעלים הרשום כדי שהמסך יוכל להציע "זאת [שם]?" ישירות.
  if (!session.participantId) {
    return NextResponse.json({
      needsIdentity: true,
      registeredName: (gallery as any).clients?.full_name ?? null,
    });
  }

  const [{ data: photosData }, { data: selectionsData }, { data: packageData }, { data: participantsData }] = await Promise.all([
    supabaseAdmin.from('photos').select('id, file_path, thumbnail_path, original_filename').eq('gallery_id', galleryId),
    supabaseAdmin.from('selections').select('photo_id, participant_id, note, status').eq('gallery_id', galleryId),
    supabaseAdmin.from('packages').select('included_photos, extra_photo_price, base_price').eq('gallery_id', galleryId).single(),
    supabaseAdmin.from('gallery_participants').select('id, display_name, is_owner').eq('gallery_id', galleryId),
  ]);

  // שאילתה נפרדת ו-best-effort ל-sharpness_score, בכוונה לא בתוך ה-select
  // הראשי של photos למעלה: אם העמודה עוד לא קיימת (המיגרציה ב-supabase/schema.sql
  // לא רצה), זו לא צריכה להפיל את טעינת הגלריה כולה - רק שלא יוצג תג טשטוש.
  const possiblyBlurryIds = new Set<string>();
  try {
    const { data: sharpnessData } = await supabaseAdmin
      .from('photos')
      .select('id, sharpness_score')
      .eq('gallery_id', galleryId)
      .not('sharpness_score', 'is', null)
      .lt('sharpness_score', BLUR_THRESHOLD);
    (sharpnessData ?? []).forEach((row: any) => possiblyBlurryIds.add(row.id));
  } catch {
    // בכוונה שקט - ראו הערה למעלה
  }

  const photos = await Promise.all(
    (photosData ?? []).map(async (photo) => {
      const thumbPath = photo.thumbnail_path ?? photo.file_path;

      const { data: thumbSigned } = await supabaseAdmin.storage
        .from('gallery-photos')
        .createSignedUrl(thumbPath, SIGNED_URL_TTL_SECONDS);

      // thumbnailUrl ו-fullUrl מצביעים לאותה גרסה (המוקטנת/עם סימן המים) -
      // file_path (המקור הנקי) לא נחשף ללקוחה בשום מקום, כולל מצב השוואה
      // מוגדל; הוא משמש רק בצד שרת לצורך המסירה הסופית (app/api/galleries/[id]/selected-photos).
      return {
        id: photo.id,
        thumbnailUrl: thumbSigned?.signedUrl ?? null,
        fullUrl: thumbSigned?.signedUrl ?? null,
        original_filename: photo.original_filename,
        possiblyBlurry: possiblyBlurryIds.has(photo.id),
      };
    })
  );

  // '#000000' הוא ערך ברירת המחדל של העמודה - צלמת שלא הגדירה צבע מותג
  // מפורש עדיין מקבלת את הפלטה הקבועה (theme.gold) בצד הלקוח, לא שחור.
  const brandColor = (gallery as any).photographers?.brand_color;
  const photographerName = (gallery as any).photographers?.business_name ?? null;
  const photographerLogo = (gallery as any).photographers?.logo_url ?? null;
  const customTheme = (gallery as any).photographers?.custom_theme ?? null;

  const participants = (participantsData ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    isOwner: p.is_owner,
  }));
  const myParticipant = participants.find((p) => p.id === session.participantId) ?? null;

  // myMarks: רק הסימונים שלי (עורכים דרכם). allMarks: כל הסימונים של כולם,
  // לתגי "מי בחר מה" על כל תמונה - כדי שאפשר יהיה לראות מה בני המשפחה
  // האחרים סימנו, בלי לערבב עם הסימון האישי שלי.
  const myMarks: Record<string, { status: 'maybe' | 'selected'; note: string | null }> = {};
  const allMarks: Record<string, { participantId: string; displayName: string; status: string }[]> = {};

  (selectionsData ?? []).forEach((s: any) => {
    if (s.participant_id === session.participantId) {
      myMarks[s.photo_id] = { status: s.status, note: s.note };
    }
    const participant = participants.find((p) => p.id === s.participant_id);
    if (!participant) return;
    if (!allMarks[s.photo_id]) allMarks[s.photo_id] = [];
    allMarks[s.photo_id].push({ participantId: s.participant_id, displayName: participant.displayName, status: s.status });
  });

  // הספירה ה"רשמית" (לחיוב, לפס ההתקדמות) היא רק של הבעלים - קלט של בני
  // משפחה אחרים הוא לדיון בלבד, לא נספר. ראו lib/session.ts ו-README.
  const ownerSelectedCount = (selectionsData ?? []).filter(
    (s: any) => s.participant_id === gallery.owner_participant_id && s.status === 'selected'
  ).length;

  return NextResponse.json({
    status: gallery.status,
    photos,
    myParticipant,
    participants,
    myMarks,
    allMarks,
    ownerSelectedCount,
    package: packageData
      ? { included: packageData.included_photos, extraPrice: packageData.extra_photo_price, basePrice: packageData.base_price }
      : null,
    brandColor: brandColor && brandColor !== '#000000' ? brandColor : null,
    customTheme,
    photographerName,
    photographerLogo,
    expiresAt: gallery.expires_at,
  });
}
