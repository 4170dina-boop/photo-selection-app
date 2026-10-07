import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { BLUR_THRESHOLD } from '@/lib/sharpness';
import { getPresignedDownloadUrl } from '@/lib/r2';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { fetchPickedPhotoIds } from '@/lib/pickQueries';
import { countBillableSelected } from '@/lib/gifts';
import { hasWatermarkedThumbnail } from '@/lib/uploadPolicy';
import { stablePhotoUrl } from '@/lib/stablePhotoUrl';
import { resolveGalleryViewAccess } from '@/lib/galleryAccess';
import { fetchClientGender, fetchParticipantGenders, resolveViewerGender } from '@/lib/gender';
import { fetchChapters, fetchPhotoNavFields } from '@/lib/chapterQueries';
import { orderForTimeline } from '@/lib/chapters';
import { burstIdByPhoto, groupBursts } from '@/lib/bursts';
import { fetchGalleryLanguage } from '@/lib/i18n/galleryLanguage';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { clientPackagePricing } from '@/lib/clientPricing';

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
    // שפת הגלריה (galleries.language) גם בלי אימות - כדי שמסך קוד הגישה
    // יוצג כבר בשפה שהצלמת קבעה. best-effort: null אם העמודה חסרה.
    return NextResponse.json(
      { error: 'לא מאומת', language: await fetchGalleryLanguage(supabaseAdmin, galleryId) },
      { status: 401 }
    );
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, delivered_at, editing_started_at, owner_participant_id, view_count, reopened_for_selection_at, clients(full_name), photographers(brand_color, business_name, logo_url, custom_theme)')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // תמונות סופיות שנמסרו (delivered_photos) - תוצאה סופית לכולם, לא בחירה
  // אישית כמו selections, אז לא תלוי ב-session.participantId ונטען עוד לפני
  // בדיקת הזיהוי למטה (מוצג גם למי שעוד לא זוהה/תה). נטען לפני בדיקת התוקף,
  // כי גם הוא קובע אם גלריה שפג תוקפה עדיין פתוחה לצפייה/הורדה.
  const { data: deliveredPhotosData } = await supabaseAdmin
    .from('delivered_photos')
    .select('id, file_path, original_filename')
    .eq('gallery_id', galleryId);

  // אחרי התפוגה: גלריה שהושלמה/נמסרה נשארת פתוחה לצפייה בלבד (readOnly) כדי
  // שאפשר יהיה להוריד את התמונות הסופיות - כתיבה (selection/note/finish/ai-picks)
  // עדיין חסומה שם ע"י checkGalleryWritable. אחרת 410 כמו קודם.
  const access = resolveGalleryViewAccess(gallery, (deliveredPhotosData ?? []).length > 0);
  if (!access.ok) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }
  const readOnly = access.readOnly;

  // "ממתין לפתיחה" (sent) -> "בבחירה" (in_progress) ברגע שהלקוחה בפועל פותחת
  // את הגלריה (קוד גישה כבר אומת ב-verify-access לפני שמגיעים לכאן) - בלי זה
  // הלוח של הצלמת ממשיך להראות "ממתין לפתיחה" לנצח, גם אחרי שהלקוחה כבר
  // בפנים ובוחרת תמונות. מותנה ב-status='sent' גם בתוך ה-UPDATE עצמו, כדי
  // שטעינה מקבילה לא תדרוס סטטוס שהשתנה בינתיים (למשל completed מ-finish).
  if (gallery.status === 'sent' && !readOnly) {
    const { data: moved } = await supabaseAdmin
      .from('galleries')
      .update({ status: 'in_progress', last_activity_at: new Date().toISOString() })
      .eq('id', galleryId)
      .eq('status', 'sent')
      .select('id');
    if (moved && moved.length > 0) gallery.status = 'in_progress';
  }

  // מונה צפיות - כל טעינה מוצלחת של הגלריה (כולל רענון), לא ייחודי לפי מבקר.
  // לצלמת אין דרך אחרת לדעת אם הלקוחה בכלל פתחה את הקישור בפועל (למשל אם
  // המייל האוטומטי לא הגיע, או שהקישור נחסם אצל הלקוחה) - ראו app/dashboard/galleries/[id]/edit/page.tsx.
  // הגדלה אטומית ב-DB (increment_gallery_view_count, ראו supabase/schema.sql),
  // כדי שטעינות מקבילות לא יאבדו ספירות. אם המיגרציה עוד לא רצה - נופלים
  // לעדכון הישן (לא אטומי). best-effort, לא חוסם את הטעינה אם נכשל.
  supabaseAdmin
    .rpc('increment_gallery_view_count', { p_gallery_id: galleryId })
    .then(
      ({ error }) => {
        if (!error) return;
        return supabaseAdmin
          .from('galleries')
          .update({ view_count: (gallery.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
          .eq('id', galleryId)
          .then(() => {}, () => {});
      },
      () => {}
    );

  const deliveredPhotos = await Promise.all(
    (deliveredPhotosData ?? []).map(async (photo) => ({
      id: photo.id,
      url: await getPresignedDownloadUrl(photo.file_path, SIGNED_URL_TTL_SECONDS),
      filename: photo.original_filename,
    }))
  );

  // שיתוף גלריה משפחתי: קוד הגישה כבר אומת, אבל עדיין לא ידוע מי בפועל
  // נכנס/ת (הבעלים הרשומה, או בן משפחה אחר) - ראו app/api/gallery/[id]/identify/route.ts.
  // מחזירים את שם הבעלים הרשום כדי שהמסך יוכל להציע "זאת [שם]?" ישירות.
  // לשון הפנייה ללקוח/ה הראשי/ת (galleries.client_gender, lib/gender.ts) -
  // שאילתה נפרדת ו-best-effort, כדי שעמודה חסרה לא תפיל את הטעינה.
  const clientGender = await fetchClientGender(supabaseAdmin, galleryId);
  // שפת הגלריה (lib/i18n) - null = עמודה חסרה, הלקוח נופל לשפת הדפדפן
  const language = await fetchGalleryLanguage(supabaseAdmin, galleryId);

  if (!session.participantId) {
    return NextResponse.json({
      needsIdentity: true,
      readOnly,
      registeredName: (gallery as any).clients?.full_name ?? null,
      registeredGender: clientGender,
      language,
      deliveredPhotos,
    });
  }

  // photos/selections עם pagination (lib/fetchAllPages.ts): PostgREST מחזיר
  // לכל היותר 1000 שורות לשאילתה - בגלריה גדולה (או משפחה שסימנה הרבה)
  // תמונות/סימונים היו נחתכים בשקט, וגם ownerSelectedCount (חיוב!) היה שגוי.
  // שגיאה כאן = 500 ולא "גלריה ריקה" - אחרת הלקוחה הייתה רואה את הבחירה שלה
  // כאילו נמחקה.
  let photosData: { id: string; file_path: string; thumbnail_path: string | null; original_filename: string }[];
  let selectionsData: { photo_id: string; participant_id: string; note: string | null; status: string; photographer_reply: string | null }[];
  let packageData: { included_photos: number; extra_photo_price: number; base_price: number } | null;
  let participantsData: { id: string; display_name: string; is_owner: boolean }[] | null;
  try {
    const [photosRows, selectionRows, { data: pkg }, { data: participantRows }] = await Promise.all([
      // סדר קבוע (סדר ההעלאה) - המספר הרץ שהלקוחה רואה על כל כרטיס ("תמונה N")
      // הוא המיקום ברשימה הזו, אז הוא חייב להיות יציב בין טעינות.
      fetchAllPages<any>((from, to) =>
        supabaseAdmin
          .from('photos')
          .select('id, file_path, thumbnail_path, original_filename')
          .eq('gallery_id', galleryId)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<any>((from, to) =>
        supabaseAdmin
          .from('selections')
          .select('photo_id, participant_id, note, status, photographer_reply')
          .eq('gallery_id', galleryId)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      supabaseAdmin.from('packages').select('included_photos, extra_photo_price, base_price').eq('gallery_id', galleryId).single(),
      supabaseAdmin.from('gallery_participants').select('id, display_name, is_owner').eq('gallery_id', galleryId),
    ]);
    photosData = photosRows;
    selectionsData = selectionRows;
    packageData = pkg;
    participantsData = participantRows;
  } catch (err) {
    console.error('[gallery] טעינת תמונות/סימונים נכשלה:', err);
    return NextResponse.json({ error: 'טעינת הגלריה נכשלה, נסו שוב' }, { status: 500 });
  }

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

  // תמונות מתנה (lib/gifts.ts) - אותו דפוס best-effort כמו sharpness_score למעלה.
  const giftById = new Map((await fetchGiftPhotos(supabaseAdmin, [galleryId])).map((g) => [g.id, g]));
  const picks = await fetchPickedPhotoIds(supabaseAdmin, galleryId);

  // רק תמונות שכבר עובדו (יש thumbnail עם סימן מים) - תמונה שהעיבוד שלה עוד
  // לא הסתיים או נכשל פשוט לא מוצגת, במקום ליפול חזרה למקור הנקי. דף ההעלאה
  // של הצלמת מפעיל עיבוד מחדש לתמונות כאלה.
  const processedPhotos = (photosData ?? []).filter(hasWatermarkedThumbnail);

  // ניווט בגלריות גדולות (lib/chapterQueries.ts) - best-effort כמו למעלה: בלי
  // המיגרציה אין פרקים ואין רצפים, והלקוחה פשוט לא רואה צ'יפים/תגי "דומות".
  // פרקים: רק אלה שיש בהם תמונה שמוצגת ללקוחה. רצפים ("תמונות דומות",
  // lib/bursts.ts): תמונות עוקבות בציר הזמן (שעת צילום, אחרת סדר ההעלאה) עם
  // חתימת dHash קרובה; burstId = מזהה התמונה הראשונה ברצף.
  const nav = await fetchPhotoNavFields(supabaseAdmin, galleryId);
  const chapterList = nav.available ? (await fetchChapters(supabaseAdmin, galleryId)).chapters : [];
  const usedChapterIds = new Set(processedPhotos.map((p) => nav.byPhoto.get(p.id)?.chapterId).filter(Boolean));
  const chapters = chapterList.filter((c) => usedChapterIds.has(c.id));
  const timeline = orderForTimeline(
    processedPhotos.map((p) => ({ id: p.id, takenAt: nav.byPhoto.get(p.id)?.takenAt ?? null }))
  );
  const burstOf = burstIdByPhoto(
    groupBursts(
      timeline.ordered.map((o) => ({
        id: o.photo.id,
        phash: nav.byPhoto.get(o.photo.id)?.phash ?? null,
        takenAt: o.hasOwnTime ? o.photo.takenAt : null,
      }))
    )
  );

  const photos = await Promise.all(
    processedPhotos.map(async (photo) => {
      // fullUrl = התצוגה הגדולה עם סימן המים (2000px) - לתצוגה מוגדלת/סליידשואו/השוואה.
      // thumbnailUrl = תמונת הגריד הקטנה (480px, אותו סימן מים) לאריחים בגריד;
      // תמונות ישנות שעוד אין להן גריד (thumbnail_path בפורמט הישן, ראו
      // gridThumbKey) נופלות חזרה לתצוגה הגדולה. בשני המקרים file_path (המקור
      // הנקי) לא נחשף ללקוחה בשום מקום; הוא משמש רק בצד שרת לצורך המסירה
      // הסופית (app/api/galleries/[id]/selected-photos).
      // כתובות קבועות (lib/stablePhotoUrl.ts) ולא URL חתום שמשתנה בכל טעינה -
      // כדי שסינון האינטרנט יבדוק כל תמונה פעם אחת בלבד. הנפילה מגריד לתצוגה
      // הגדולה קורית עכשיו בתוך ה-route של התמונה.
      return {
        id: photo.id,
        thumbnailUrl: stablePhotoUrl(galleryId, photo.id, 'grid'),
        fullUrl: stablePhotoUrl(galleryId, photo.id, 'full'),
        original_filename: photo.original_filename,
        possiblyBlurry: possiblyBlurryIds.has(photo.id),
        isGift: giftById.has(photo.id),
        giftMessage: giftById.get(photo.id)?.gift_message ?? null,
        isPick: picks.ids.has(photo.id),
        chapterId: nav.byPhoto.get(photo.id)?.chapterId ?? null,
        burstId: burstOf.get(photo.id) ?? null,
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

  // מי הצופה: בעלים -> client_gender, אורח/ת -> gallery_participants.gender
  // (null = לא ידוע -> פנייה ניטרלית בצד הלקוח). best-effort כמו למעלה.
  const participantGenders = myParticipant && !myParticipant.isOwner
    ? await fetchParticipantGenders(supabaseAdmin, galleryId)
    : new Map();
  const viewerGender = myParticipant
    ? resolveViewerGender({
        isOwner: myParticipant.isOwner,
        clientGender,
        participantGender: participantGenders.get(myParticipant.id) ?? null,
      })
    : null;

  // myMarks: רק הסימונים שלי (עורכים דרכם). allMarks: כל הסימונים של כולם,
  // לתגי "מי בחר מה" על כל תמונה - כדי שאפשר יהיה לראות מה בני המשפחה
  // האחרים סימנו, בלי לערבב עם הסימון האישי שלי.
  const myMarks: Record<string, { status: 'maybe' | 'selected'; note: string | null; photographerReply: string | null }> = {};
  const allMarks: Record<string, { participantId: string; displayName: string; status: string }[]> = {};

  (selectionsData ?? []).forEach((s: any) => {
    if (s.participant_id === session.participantId) {
      myMarks[s.photo_id] = { status: s.status, note: s.note, photographerReply: s.photographer_reply ?? null };
    }
    const participant = participants.find((p) => p.id === s.participant_id);
    if (!participant) return;
    if (!allMarks[s.photo_id]) allMarks[s.photo_id] = [];
    allMarks[s.photo_id].push({ participantId: s.participant_id, displayName: participant.displayName, status: s.status });
  });

  // amount_due_override בשאילתה נפרדת ו-best-effort (כמו sharpness_score
  // למעלה) - עמודה חסרה (מיגרציה שלא רצה) = אין סכום ידני, בלי להפיל את הטעינה.
  let amountDueOverride: number | string | null = null;
  try {
    const { data: overrideRow, error: overrideError } = await supabaseAdmin
      .from('galleries')
      .select('amount_due_override')
      .eq('id', galleryId)
      .maybeSingle();
    if (!overrideError) amountDueOverride = (overrideRow as any)?.amount_due_override ?? null;
  } catch {
    // בכוונה שקט - ראו הערה למעלה
  }

  // הספירה ה"רשמית" (לחיוב, לפס ההתקדמות) היא רק של הבעלים - קלט של בני
  // משפחה אחרים הוא לדיון בלבד, לא נספר. ראו lib/session.ts ו-README.
  // תמונות מתנה לא נספרות למכסה/לחיוב (lib/gifts.ts).
  const ownerSelectedCount = countBillableSelected(
    (selectionsData ?? []).filter((s: any) => s.participant_id === gallery.owner_participant_id),
    Array.from(giftById.keys())
  );

  return NextResponse.json({
    status: gallery.status,
    readOnly,
    reopenedForSelectionAt: gallery.reopened_for_selection_at,
    // "מה הבא?" (lib/clientProgress.ts) - רק דגלים, בלי התאריכים הפנימיים.
    // הרענון בפוקוס עובר דרך app/api/gallery/[id]/progress (קל יותר).
    editingStarted: !!(gallery as any).editing_started_at,
    delivered: !!gallery.delivered_at || deliveredPhotos.length > 0,
    photos,
    chapters,
    deliveredPhotos,
    myParticipant,
    participants,
    viewerGender,
    // לטקסטים בגוף שלישי על הבעלים ("רק X יכולה לסיים")
    ownerGender: clientGender,
    language,
    myMarks,
    allMarks,
    ownerSelectedCount,
    giftCount: giftById.size,
    // סכום ידני של הצלמת (galleries.amount_due_override) גובר על החישוב
    // "N × מחיר" - ראו lib/clientPricing.ts. הסכום עצמו רק לבעלים.
    package: clientPackagePricing(packageData, amountDueOverride, !!myParticipant?.isOwner),
    brandColor: brandColor && brandColor !== '#000000' ? brandColor : null,
    customTheme,
    photographerName,
    photographerLogo,
    expiresAt: gallery.expires_at,
  });
}
