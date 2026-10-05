'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { theme, goldButtonStyle, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { useUploadQueue, type UploadItem } from '../../UploadProvider';
import { GIFT_MESSAGE_MAX_LENGTH } from '@/lib/gifts';
import {
  FREE_PHOTO_LIMIT,
  PROCESS_RETRY_GRACE_MS,
  indicesToUpload,
  mapWithConcurrency,
  photosNeedingProcessRetry,
} from '@/lib/uploadPolicy';
import { originalsUploadBlockReason } from '@/lib/galleryLifecycle';

interface UploadPageProps {
  params: { galleryId: string };
}

interface ExistingPhoto {
  id: string;
  thumbnailUrl: string | null;
  original_filename: string;
  status: 'maybe' | 'selected' | null;
  note: string | null;
  photographerReply: string | null;
  // תמונת מתנה (lib/gifts.ts) - בונוס ללקוחה, לא נספר במכסה/בחיוב
  isGift: boolean;
  giftMessage: string | null;
  // אין עדיין thumbnail עם סימן מים - התמונה מוסתרת מהלקוחה עד שהעיבוד יצליח
  needsProcessing: boolean;
  // תמונה ישנה שעובדה לפני תמונות הגריד הקטנות - מושלמת ברקע (ראו למטה)
  needsGridThumb?: boolean;
  createdAt: string | null;
}

// כמה בקשות עיבוד חוזר (/process) רצות בו-זמנית - כל אחת כבדה בצד שרת.
const PROCESS_RETRY_CONCURRENCY = 3;
// השלמת תמונת גריד לתמונות ישנות (/process?mode=grid) - קלה (מורידה רק את
// התצוגה הקיימת, לא את המקור), אבל עדיין לא מציפים את השרת.
const GRID_BACKFILL_CONCURRENCY = 2;

const FULL_RES_STORAGE_KEY = 'upload-full-resolution';

export default function UploadPage({ params }: UploadPageProps) {
  const { galleryId } = params;

  // תור ההעלאה עצמו (items/uploading) חי ב-context משותף לכל הדשבורד (ראו
  // app/dashboard/UploadProvider.tsx), כדי שהוא ישרוד ניווט לדף אחר - הדף הזה
  // רק קורא את הפרוסה שלו (לפי galleryId) ומפעיל עליה פעולות. סקירת התמונות
  // הקיימות, בדיקת הבעלות, וזיהוי כפילויות נשארים מקומיים לדף - אלה קריאות
  // מידע ספציפיות לדף, לא חלק ממנוע ההעלאה שצריך להמשיך לרוץ ברקע.
  const { items, uploading, setItems, setClientName, startUpload } = useUploadQueue(galleryId);

  // כברירת מחדל התמונות מוקטנות בדפדפן ל-3000px לפני ההעלאה (lib/uploadResize.ts)
  // - מהיר פי כמה. "רזולוציה מלאה" מעלה את הקובץ המקורי כמו שהוא, למי שמורידה
  // את הקבצים בחזרה לעריכה (הורדת ZIP בכפתור הקסם). נזכר לפי דפדפן בלבד.
  const [fullResolution, setFullResolution] = useState(false);
  useEffect(() => {
    try {
      setFullResolution(localStorage.getItem(FULL_RES_STORAGE_KEY) === '1');
    } catch {
      // אין גישה ל-localStorage (גלישה פרטית וכו') - נשארים עם ברירת המחדל
    }
  }, []);
  function toggleFullResolution(value: boolean) {
    setFullResolution(value);
    try {
      localStorage.setItem(FULL_RES_STORAGE_KEY, value ? '1' : '0');
    } catch {
      // לא קריטי - ההעדפה פשוט לא תיזכר
    }
  }

  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[] | null>(null);
  const [checkingOwnership, setCheckingOwnership] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // תגובה להערת לקוחה על תמונה - אותו דפוס בדיוק כמו noteEditingId/noteDraft
  // בגלריית הלקוחה (app/gallery/[id]/page.tsx), רק בכיוון ההפוך.
  const [replyEditingId, setReplyEditingId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [replyError, setReplyError] = useState('');

  // סימון "תמונת מתנה" + הודעה אישית אופציונלית - אותו דפוס כמו עורך התגובה למעלה.
  const [giftEditingId, setGiftEditingId] = useState<string | null>(null);
  const [giftDraft, setGiftDraft] = useState('');
  const [savingGift, setSavingGift] = useState(false);
  const [giftError, setGiftError] = useState('');
  // תמונות המקור נמחקו (cron, 30 יום אחרי המסירה) - אי אפשר יותר לשנות מתנות
  // (השרת גם דוחה, ראו app/api/galleries/[id]/photos/[photoId]/gift/route.ts).
  const [originalsCleanedUp, setOriginalsCleanedUp] = useState(false);
  // הגלריה הושלמה (ולא נפתחה מחדש) / פג תוקפה / המקור נמחק - העלאת מקור חדש
  // חסומה (השרת אוכף גם הוא, ראו .../photos/presign-upload).
  const [uploadBlockReason, setUploadBlockReason] = useState<string | null>(null);

  // מוודאים שהגלריה שייכת לצלמת המחוברת (אותו דפוס כמו דף העריכה) לפני שמציגים
  // את ממשק ההעלאה - בלי זה, כל צלמת יכולה לנווט לפי galleryId של גלריה של
  // צלמת אחרת ולראות ממשק העלאה שלא באמת עובד (ה-RLS חוסם את הכתיבה בפועל,
  // אבל בלי הבדיקה הזו זה מרגיש שבור במקום שיגיד בבירור "לא נמצא").
  //
  // checkingOwnership מפסיק לחסום רק אחרי ששתי הבקשות (בדיקת בעלות + טעינת
  // התמונות הקיימות) הסתיימו, לא רק הראשונה - קודם setCheckingOwnership(false)
  // היה קורה כבר אחרי הבקשה הראשונה, לפני ש-existingPhotos התמלא, וזה פתח חלון
  // (סבב רשת אחד) שבו אפשר לבחור קבצים כש-buildItems עדיין רואה existingPhotos
  // כ-null (=[]) ומפספס כפילויות אמיתיות מול תמונות שכבר קיימות בגלריה.
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/galleries/${galleryId}`);
      if (!res.ok) {
        setNotFound(true);
        setCheckingOwnership(false);
        return;
      }
      const gallery = await res.json().catch(() => null);
      setClientName(gallery?.clients?.full_name ?? null);
      setOriginalsCleanedUp(!!gallery?.originals_cleaned_up_at);
      setUploadBlockReason(gallery ? originalsUploadBlockReason(gallery, new Date()) : null);
      await loadExistingPhotos();
      setCheckingOwnership(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  async function loadExistingPhotos() {
    const res = await fetch(`/api/galleries/${galleryId}/review`);
    if (!res.ok) return;
    const data = await res.json();
    setExistingPhotos(data.photos ?? []);
  }

  function openReplyEditor(photo: ExistingPhoto) {
    setReplyError('');
    setReplyEditingId(photo.id);
    setReplyDraft(photo.photographerReply ?? '');
  }

  async function saveReply() {
    if (!replyEditingId) return;
    const photoId = replyEditingId;
    const trimmed = replyDraft.trim();

    setSavingReply(true);
    setReplyError('');

    const res = await fetch(`/api/galleries/${galleryId}/photos/${photoId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: trimmed }),
    });

    setSavingReply(false);

    if (!res.ok) {
      setReplyError('שמירת התגובה נכשלה, נסי שוב');
      return;
    }

    setExistingPhotos((prev) =>
      (prev ?? []).map((p) => (p.id === photoId ? { ...p, photographerReply: trimmed || null } : p))
    );
    setReplyEditingId(null);
  }

  function openGiftEditor(photo: ExistingPhoto) {
    if (originalsCleanedUp) return;
    setGiftError('');
    setGiftEditingId(photo.id);
    setGiftDraft(photo.giftMessage ?? '');
  }

  // isGift=false מבטל את המתנה (וגם מוחק את ההודעה בצד השרת).
  async function saveGift(isGift: boolean) {
    if (!giftEditingId) return;
    const photoId = giftEditingId;

    setSavingGift(true);
    setGiftError('');

    const res = await fetch(`/api/galleries/${galleryId}/photos/${photoId}/gift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isGift, message: isGift ? giftDraft : null }),
    });
    const data = await res.json().catch(() => ({}));

    setSavingGift(false);

    if (!res.ok) {
      setGiftError(data.error ?? 'שמירת המתנה נכשלה, נסי שוב');
      return;
    }

    setExistingPhotos((prev) =>
      (prev ?? []).map((p) =>
        p.id === photoId ? { ...p, isGift: !!data.isGift, giftMessage: data.giftMessage ?? null } : p
      )
    );
    setGiftEditingId(null);
  }

  // כשההעלאה שרצה ברקע (ב-context) מסתיימת בזמן שהדף הזה עדיין פתוח, מרעננים
  // את סקירת התמונות הקיימות כדי לכלול את החדשות - בדיוק כמו שהדף עשה בעבר
  // מיד אחרי handleUpload. אם הדף נטען מחדש אחרי שההעלאה כבר הסתיימה (למשל
  // חזרה מדף אחר), האפקט שלמעלה כבר טוען גרסה עדכנית ממילא - זה רק בשביל
  // המעבר "עדיין פה כשזה נגמר".
  const prevUploadingRef = useRef(uploading);
  useEffect(() => {
    if (prevUploadingRef.current && !uploading) {
      loadExistingPhotos();
    }
    prevUploadingRef.current = uploading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading]);

  // עיבוד חוזר לתמונות בלי thumbnail (העיבוד ב-UploadProvider הוא fire-and-forget,
  // ואם הוא נכשל - למשל timeout - התמונה נשארת מוסתרת מהלקוחה). מנסים כל תמונה
  // פעם אחת לכל טעינת דף (attemptedProcessRef), כדי שתמונה פגומה לא תיכנס
  // ללולאה אינסופית. תמונות שהועלו ממש עכשיו מקבלות זמן חסד (העיבוד המקורי
  // שלהן אולי עוד רץ) - בודקים אותן שוב כשזמן החסד נגמר.
  const attemptedProcessRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (uploading || !existingPhotos) return;

    const due = photosNeedingProcessRetry(existingPhotos, Date.now(), attemptedProcessRef.current);
    if (due.length > 0) {
      due.forEach((p) => attemptedProcessRef.current.add(p.id));
      (async () => {
        await mapWithConcurrency(due, PROCESS_RETRY_CONCURRENCY, (p) =>
          fetch(`/api/galleries/${galleryId}/photos/${p.id}/process`, { method: 'POST' }).catch(() => null)
        );
        loadExistingPhotos();
      })();
      return;
    }

    const waiting = existingPhotos.some((p) => p.needsProcessing && !attemptedProcessRef.current.has(p.id));
    if (!waiting) return;
    const timer = setTimeout(loadExistingPhotos, PROCESS_RETRY_GRACE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingPhotos, uploading, galleryId]);

  // השלמה "עצלה" של תמונות גריד קטנות לתמונות ישנות: כל פעם שהצלמת פותחת את
  // הדף, מנסים כל תמונה כזו פעם אחת. בסוף טוענים מחדש, כי ההשלמה מוחקת את
  // ה-thumbnail בפורמט הישן שה-URL הנוכחי במסך מפנה אליו. עד שזה קורה הלקוחה
  // פשוט מקבלת את התצוגה הגדולה גם בגריד, כמו פעם.
  const attemptedGridRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (uploading || !existingPhotos) return;
    const due = existingPhotos.filter((p) => p.needsGridThumb && !p.needsProcessing && !attemptedGridRef.current.has(p.id));
    if (due.length === 0) return;
    due.forEach((p) => attemptedGridRef.current.add(p.id));
    mapWithConcurrency(due, GRID_BACKFILL_CONCURRENCY, (p) =>
      fetch(`/api/galleries/${galleryId}/photos/${p.id}/process?mode=grid`, { method: 'POST' }).catch(() => null)
    ).then(() => loadExistingPhotos());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingPhotos, uploading, galleryId]);

  // מסמנים קבצים ששמם חוזר על עצמו בתוך הבחירה הנוכחית, או שכבר קיימים
  // בגלריה (לפי original_filename) - השוואה מדויקת של השם, בלי נרמול.
  function buildItems(selected: File[]): UploadItem[] {
    const existingNames = new Set((existingPhotos ?? []).map((p) => p.original_filename));
    const nameCounts = new Map<string, number>();
    selected.forEach((file) => nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1));

    return selected.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'pending',
      isDuplicateExisting: existingNames.has(file.name),
      isDuplicateInSelection: (nameCounts.get(file.name) ?? 0) > 1,
    }));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems(buildItems(selected));
  }

  // בחירת תיקייה שלמה (webkitdirectory) לא תומכת ב-accept="image/*" - הדפדפן
  // מחזיר את כל הקבצים בתיקייה (כולל למשל .DS_Store), אז מסננים ידנית לפי
  // סוג הקובץ בפועל אחרי הבחירה.
  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems(buildItems(selected));
  }

  const doneCount = items.filter((it) => it.status === 'done').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
  // רק מה שעוד לא הועלה (pending/error) - זה מה ש-startUpload ישלח בפועל
  const toUploadCount = indicesToUpload(items).length;
  const processingCount = (existingPhotos ?? []).filter((p) => p.needsProcessing).length;
  const duplicateCount = items.filter((it) => it.isDuplicateExisting || it.isDuplicateInSelection).length;
  const allProcessed = items.length > 0 && items.every((it) => it.status === 'done' || it.status === 'error');
  // בזמן העלאה: מוסיפים doneCount לספירה החיה. אחרי סיום: loadExistingPhotos
  // כבר רענן את existingPhotos לכלול את החדשות, אז לא מוסיפים doneCount שוב.
  const totalPhotoCount = existingPhotos === null ? null : existingPhotos.length + (uploading ? doneCount : 0);

  if (checkingOwnership) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  if (notFound) {
    return (
      <div>
        <p style={{ color: theme.errorText, marginBottom: '1rem' }}>הגלריה לא נמצאה.</p>
        <Link href="/dashboard/galleries" style={{ color: theme.textMuted }}>
          חזרה לרשימת הגלריות
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>העלאת תמונות לגלריה</h1>

      {totalPhotoCount !== null && (
        <p style={{ color: totalPhotoCount >= FREE_PHOTO_LIMIT ? theme.errorText : theme.textMuted, fontSize: 13, marginBottom: '1rem' }}>
          {totalPhotoCount}/{FREE_PHOTO_LIMIT} תמונות בגלריה (חשבון חינמי)
        </p>
      )}

      {existingPhotos !== null && existingPhotos.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontFamily: theme.fontSerif, fontSize: 16, marginBottom: '0.25rem' }}>
            סקירת תמונות ({existingPhotos.length})
          </h2>
          <p style={{ color: theme.textFaint, fontSize: 12, marginBottom: '0.75rem' }}>
            🎁 לחיצה על המתנה בפינת התמונה מסמנת אותה כ"תמונת מתנה" - הלקוחה מקבלת אותה בחינם,
            והיא לא נספרת במכסת החבילה ולא בחיוב על תמונות נוספות.
            {existingPhotos.some((p) => p.isGift) && ` (${existingPhotos.filter((p) => p.isGift).length} מסומנות כמתנה)`}
          </p>
          {processingCount > 0 && (
            <p style={{ color: theme.warningText, fontSize: 12, marginBottom: '0.75rem' }}>
              {processingCount} תמונות עדיין בעיבוד (יצירת סימן מים) ולא מוצגות ללקוחה - העיבוד ינוסה שוב אוטומטית.
            </p>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {existingPhotos.map((photo) => {
              const borderColor = photo.isGift
                ? theme.goldBright
                : photo.status === 'selected' ? theme.gold : photo.status === 'maybe' ? theme.green : theme.border;
              const statusLabel = photo.isGift
                ? '🎁 מתנה'
                : photo.status === 'selected' ? 'נבחר' : photo.status === 'maybe' ? 'אולי' : null;

              return (
                <div
                  key={photo.id}
                  style={{
                    position: 'relative', borderRadius: 8, overflow: 'hidden',
                    border: `2px solid ${borderColor}`, background: theme.panel,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumbnailUrl ?? ''}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }}
                  />
                  {statusLabel && (
                    <span
                      style={{
                        position: 'absolute', top: 6, left: 6,
                        background: photo.isGift ? theme.goldBright : photo.status === 'selected' ? theme.gold : theme.green,
                        color: theme.goldText, fontSize: 10, fontWeight: 'bold',
                        padding: '2px 7px', borderRadius: 10,
                      }}
                    >
                      {statusLabel}
                    </span>
                  )}
                  {photo.needsProcessing && (
                    <span
                      title="סימן המים עוד לא נוצר - התמונה לא מוצגת ללקוחה עד שהעיבוד יסתיים"
                      style={{
                        position: 'absolute', bottom: photo.note ? 22 : 6, left: 6,
                        background: theme.warningBg, color: theme.warningText, fontSize: 10,
                        padding: '2px 7px', borderRadius: 10,
                      }}
                    >
                      בעיבוד
                    </span>
                  )}
                  <button
                    onClick={() => openGiftEditor(photo)}
                    disabled={originalsCleanedUp}
                    title={
                      originalsCleanedUp
                        ? 'תמונות המקור כבר נמחקו - אי אפשר לשנות תמונות מתנה'
                        : photo.isGift
                          ? `תמונת מתנה${photo.giftMessage ? ` - "${photo.giftMessage}"` : ''} · לחצי לעריכה`
                          : 'סימון כתמונת מתנה'
                    }
                    aria-label={photo.isGift ? 'עריכת תמונת מתנה' : 'סימון כתמונת מתנה'}
                    aria-pressed={photo.isGift}
                    style={{
                      position: 'absolute', top: 6, right: 6, cursor: originalsCleanedUp ? 'default' : 'pointer',
                      width: 26, height: 26, borderRadius: '50%', fontSize: 13,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${photo.isGift ? theme.goldBright : 'rgba(255,255,255,0.4)'}`,
                      background: photo.isGift ? theme.goldBright : 'rgba(0,0,0,0.55)',
                      opacity: photo.isGift ? 1 : originalsCleanedUp ? 0.4 : 0.85,
                    }}
                  >
                    🎁
                  </button>
                  {photo.note && (
                    <button
                      onClick={() => openReplyEditor(photo)}
                      title={photo.photographerReply ? `${photo.note} — התגובה שלך: ${photo.photographerReply}` : `${photo.note} — לחצי כדי להגיב`}
                      style={{
                        position: 'absolute', bottom: 0, insetInline: 0, textAlign: 'right', cursor: 'pointer',
                        background: 'rgba(0,0,0,0.65)', color: theme.text, fontSize: 10, border: 'none',
                        padding: '3px 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {photo.photographerReply ? '💬 ' : '✎ '}{photo.note}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {uploadBlockReason && (
        <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.75rem 1rem', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          {uploadBlockReason}
        </p>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <label style={{ ...goldButtonStyle, display: 'inline-block', opacity: uploadBlockReason ? 0.5 : 1, cursor: uploadBlockReason ? 'not-allowed' : 'pointer' }}>
          בחירת תמונות
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            disabled={uploading || !!uploadBlockReason}
            style={{ display: 'none' }}
          />
        </label>

        <label
          style={{
            display: 'inline-block', padding: '0.6rem 1.1rem', borderRadius: 8,
            border: `1px solid ${theme.border}`, color: theme.text, cursor: uploadBlockReason ? 'not-allowed' : uploading ? 'default' : 'pointer',
            opacity: uploadBlockReason ? 0.5 : uploading ? 0.6 : 1,
          }}
        >
          בחירת תיקייה שלמה
          <input
            type="file"
            // @ts-expect-error webkitdirectory לא בטיפוסי TypeScript הרשמיים, אבל נתמך בכל הדפדפנים המרכזיים
            webkitdirectory=""
            directory=""
            multiple
            onChange={handleFolderSelect}
            disabled={uploading || !!uploadBlockReason}
            style={{ display: 'none' }}
          />
        </label>

        {items.length > 0 && (
          <span style={{ color: theme.textMuted }}>{items.length} קבצים נבחרו</span>
        )}

        {items.length > 0 && (uploading || toUploadCount > 0) && (
          <button
            onClick={() => startUpload({ fullResolution })}
            disabled={uploading || toUploadCount === 0 || !!uploadBlockReason}
            style={{
              ...goldButtonStyle,
              background: 'transparent',
              border: `1px solid ${theme.gold}`,
              color: theme.gold,
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading
              ? `מעלה... (${doneCount}/${items.length})`
              : errorCount > 0
                ? `נסי שוב (${errorCount} שנכשלו)`
                : 'העלה תמונות'}
          </button>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1.5rem', fontSize: 13, color: theme.textMuted, cursor: uploading ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          checked={fullResolution}
          disabled={uploading}
          onChange={(e) => toggleFullResolution(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          העלאה ברזולוציה מלאה (איטית יותר)
          <span style={{ display: 'block', fontSize: 12, color: theme.textFaint }}>
            בלי הסימון התמונות מוקטנות ל-3000 פיקסלים - איכות מלאה לצפייה ולבחירה של הלקוחה, וההעלאה מהירה פי כמה.
            כדאי לסמן רק אם את מורידה את התמונות הנבחרות כ-ZIP כדי לערוך אותן (ולא עובדת עם כפתור הקסם על הקבצים המקוריים שלך).
          </span>
        </span>
      </label>

      {duplicateCount > 0 && (
        <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>
          ⚠️ {duplicateCount} מהקבצים שנבחרו כבר קיימים בגלריה או נבחרו יותר מפעם אחת - אפשר להעלות בכל זאת אם זה מכוון
        </p>
      )}

      {allProcessed && errorCount === 0 && (
        <p style={{ background: theme.successBg, color: theme.successText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          כל התמונות הועלו בהצלחה!
        </p>
      )}

      {items.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '1rem',
          }}
        >
          {items.map((item, i) => {
            const isDuplicate = item.isDuplicateExisting || item.isDuplicateInSelection;
            const borderColor =
              item.status === 'error' ? theme.errorText
              : item.status === 'done' ? theme.green
              : isDuplicate ? theme.warningText
              : theme.border;

            return (
              <div
                key={i}
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  overflow: 'hidden',
                  border: `2px solid ${borderColor}`,
                  background: theme.panel,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  // מאות תצוגות מקדימות של קבצי מצלמה מלאים - פענוח מחוץ
                  // ל-main thread ורק כשנגללים אליהן, כדי לא להאט את ההקטנה/ההעלאה.
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', opacity: item.status === 'error' ? 0.5 : 1 }}
                />

                <div
                  style={{
                    position: 'absolute', bottom: 0, insetInline: 0,
                    background: 'rgba(0,0,0,0.6)', color: theme.text, fontSize: 11,
                    padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
                  <span>
                    {item.status === 'pending' && '⋯'}
                    {item.status === 'uploading' && '↑'}
                    {item.status === 'done' && <span title="הועלה - סימן המים מתווסף ברקע" style={{ color: theme.green }}>✓</span>}
                    {item.status === 'error' && <span style={{ color: theme.errorText }}>✕</span>}
                  </span>
                </div>

                {(isDuplicate || (item.status === 'error' && item.error)) && (
                  <div style={{ position: 'absolute', top: 0, insetInline: 0, display: 'flex', flexDirection: 'column' }}>
                    {isDuplicate && (
                      <div style={{ background: theme.warningBg, color: theme.warningText, fontSize: 11, padding: '4px 8px' }}>
                        {item.isDuplicateExisting ? '⚠️ קובץ בשם זה כבר קיים בגלריה' : '⚠️ כבר נבחר'}
                      </div>
                    )}
                    {item.status === 'error' && item.error && (
                      <div style={{ background: theme.errorBg, color: theme.errorText, fontSize: 11, padding: '4px 8px' }}>
                        {item.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {replyEditingId && (() => {
        const photo = (existingPhotos ?? []).find((p) => p.id === replyEditingId);
        if (!photo) return null;
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setReplyEditingId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 340, border: `1px solid ${theme.border}` }}
            >
              <div style={{ background: theme.panelInput, borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: 13 }}>
                <div style={{ color: theme.textFaint, fontSize: 11, marginBottom: '0.25rem' }}>הערת הלקוחה:</div>
                {photo.note}
              </div>

              <label htmlFor="reply-text" style={{ display: 'block', fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>
                תגובה שלך
              </label>
              <textarea
                id="reply-text"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={3}
                style={{ ...inputStyle, width: '100%' }}
                placeholder="למשל: סוכם, נדגיש את זה בעריכה"
                autoFocus
              />
              {replyError && <p style={{ color: theme.errorText, fontSize: 12, marginTop: '0.5rem' }}>{replyError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button onClick={saveReply} disabled={savingReply} style={{ ...goldButtonStyle, padding: '0.5rem 1rem', opacity: savingReply ? 0.6 : 1 }}>
                  {savingReply ? 'שומרת...' : 'שמירה'}
                </button>
                <button onClick={() => setReplyEditingId(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>ביטול</button>
              </div>
            </div>
          </div>
        );
      })()}

      {giftEditingId && (() => {
        const photo = (existingPhotos ?? []).find((p) => p.id === giftEditingId);
        if (!photo) return null;
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setGiftEditingId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="gift-dialog-title"
              onClick={(e) => e.stopPropagation()}
              style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 340, maxWidth: 'calc(100vw - 2rem)', border: `1px solid ${theme.border}` }}
            >
              <div id="gift-dialog-title" style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.35rem' }}>
                🎁 תמונת מתנה
              </div>
              <p style={{ color: theme.textMuted, fontSize: 12, marginBottom: '0.75rem', lineHeight: 1.5 }}>
                {photo.original_filename} תופיע ללקוחה מודגשת ככלולה אוטומטית, בלי לגרוע ממכסת החבילה ובלי תוספת תשלום.
                היא תיכלל גם בייצוא ובהורדה לעריכה.
              </p>

              <label htmlFor="gift-message" style={{ display: 'block', fontSize: 13, marginBottom: '0.35rem' }}>
                הודעה אישית ללקוחה (לא חובה)
              </label>
              <textarea
                id="gift-message"
                value={giftDraft}
                onChange={(e) => setGiftDraft(e.target.value)}
                rows={3}
                maxLength={GIFT_MESSAGE_MAX_LENGTH}
                style={{ ...inputStyle, width: '100%' }}
                placeholder="למשל: את זו פשוט לא יכולתי שלא לתת לך 💛"
                autoFocus
              />
              <div style={{ color: theme.textFaint, fontSize: 11, marginTop: '0.25rem' }}>
                {giftDraft.trim().length}/{GIFT_MESSAGE_MAX_LENGTH}
              </div>
              {giftError && <p style={{ color: theme.errorText, fontSize: 12, marginTop: '0.5rem' }}>{giftError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button onClick={() => saveGift(true)} disabled={savingGift} style={{ ...goldButtonStyle, padding: '0.5rem 1rem', opacity: savingGift ? 0.6 : 1 }}>
                  {savingGift ? 'שומרת...' : photo.isGift ? 'שמירה' : 'סימון כמתנה'}
                </button>
                {photo.isGift && (
                  <button onClick={() => saveGift(false)} disabled={savingGift} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem', opacity: savingGift ? 0.6 : 1 }}>
                    ביטול המתנה
                  </button>
                )}
                <button onClick={() => setGiftEditingId(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>סגירה</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
