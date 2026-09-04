'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { theme } from '@/lib/theme';

// תור ההעלאה חי כאן (context גלובלי לדשבורד) ולא ב-state מקומי של דף ההעלאה,
// כדי שהעלאה שכבר רצה תמשיך (ותוצג בפס ההתקדמות הצף) גם כשהצלמת עוברת
// לדף אחר תחת /dashboard - app/dashboard/layout.tsx נשאר מורכב (mounted) לאורך
// כל הניווט הפנימי בין דפי הדשבורד, אז UploadProvider שעטוף שם לא מתפרק
// בין דף לדף, בניגוד לרכיב הדף עצמו שדווקא כן מתחלף/נטען מחדש כשה-galleryId
// ב-URL משתנה.

export interface UploadItem {
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  isDuplicateExisting?: boolean; // כבר קיים בגלריה (לפי original_filename)
  isDuplicateInSelection?: boolean; // נבחר יותר מפעם אחת בבחירה הנוכחית
}

interface GalleryUploadState {
  items: UploadItem[];
  uploading: boolean;
  clientName: string | null;
  // האם פס ההתקדמות הצף (ב-layout) מוצג בשביל הגלריה הזו כרגע - נדלק כשמתחילים
  // להעלות, ונכבה בעיכוב קצר אחרי שההעלאה מסתיימת (ראו BANNER_FADE_MS למטה),
  // בלי לגעת ב-items/uploading עצמם - אלה נשארים כמו שהיו כדי שדף ההעלאה
  // (אם עדיין פתוח, או ייפתח מחדש) ימשיך להציג את התוצאה הסופית כרגיל.
  showBanner: boolean;
}

const EMPTY_STATE: GalleryUploadState = { items: [], uploading: false, clientName: null, showBanner: false };

interface UploadContextValue {
  states: Record<string, GalleryUploadState>;
  setGalleryItems: (galleryId: string, items: UploadItem[]) => void;
  setClientName: (galleryId: string, name: string | null) => void;
  startUpload: (galleryId: string) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

// הוק נוחות לדף ההעלאה - חושף רק את מה שרלוונטי לגלריה הספציפית שהוא מציג,
// בלי שהדף יצטרך לדעת על שאר הגלריות שיש להן תור פעיל ב-context.
export function useUploadQueue(galleryId: string) {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploadQueue חייב לרוץ בתוך UploadProvider');
  const state = ctx.states[galleryId] ?? EMPTY_STATE;

  return {
    items: state.items,
    uploading: state.uploading,
    setItems: useCallback((items: UploadItem[]) => ctx.setGalleryItems(galleryId, items), [ctx, galleryId]),
    setClientName: useCallback((name: string | null) => ctx.setClientName(galleryId, name), [ctx, galleryId]),
    startUpload: useCallback(() => ctx.startUpload(galleryId), [ctx, galleryId]),
  };
}

// כמה תמונות מעלים בו-זמנית. קודם זה היה אחת-אחת (תור) - עכשיו גם לא מחכים
// יותר לעיבוד סימן המים לפני שעוברים לתמונה הבאה (ראו הערה ב-uploadOne), אז
// שלב ההעלאה עצמו (Storage + DB) מהיר בהרבה, ואפשר להעלות יותר תמונות בו-זמנית
// בלי לחשוש שכל "עובד" תקוע מחכה לעיבוד איטי בצד שרת.
const UPLOAD_CONCURRENCY = 8;

// דחיסת JPEG לפני העלאה, כדי לקצר משמעותית את זמן ההעלאה בפועל (פחות בייטים
// לשלוח, לא רק פחות המתנה לעיבוד). לא נוגעים ברזולוציה (רק באיכות ה-JPEG) -
// אין הבדל נראה לעין במסך או בהדפסה רגילה, וממילא הקובץ הזה לא הקובץ שהצלמת
// עורכת בפועל (היא עובדת על המקור המקומי שלה, ראו MagicButton) - הוא רק
// לתצוגה/בחירה של הלקוחה. אם הדחיסה נכשלת או לא משפרת, מעלים את המקור כמו שהוא.
const COMPRESSED_JPEG_QUALITY = 0.85;

async function compressForUpload(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', COMPRESSED_JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// כמה זמן פס ההתקדמות הצף נשאר מוצג אחרי שההעלאה לגלריה מסתיימת, לפני שהוא
// נעלם - אותו דפוס של הודעות זמניות שכבר קיים בדשבורד (setTimeout שמכבה state,
// ראו למשל setShowCelebration/setCopied בדפים אחרים).
const BANNER_FADE_MS = 5000;

export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [states, setStates] = useState<Record<string, GalleryUploadState>>({});
  const fadeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateGallery = useCallback((galleryId: string, updater: (prev: GalleryUploadState) => GalleryUploadState) => {
    setStates((prev) => ({ ...prev, [galleryId]: updater(prev[galleryId] ?? EMPTY_STATE) }));
  }, []);

  const setGalleryItems = useCallback(
    (galleryId: string, items: UploadItem[]) => {
      updateGallery(galleryId, (prev) => ({ ...prev, items }));
    },
    [updateGallery]
  );

  const setClientName = useCallback(
    (galleryId: string, name: string | null) => {
      updateGallery(galleryId, (prev) => ({ ...prev, clientName: name }));
    },
    [updateGallery]
  );

  async function uploadOne(galleryId: string, i: number, originalFile: File) {
    updateGallery(galleryId, (prev) => ({
      ...prev,
      items: prev.items.map((it, idx) => (idx === i ? { ...it, status: 'uploading' } : it)),
    }));

    try {
      const file = await compressForUpload(originalFile);

      // אחסון עבר ל-Cloudflare R2 (ראו lib/r2.ts) - ל-R2 (כמו S3) אין מקבילה
      // ל-RLS שמאפשרת לדפדפן להעלות ישירות בבטחה, אז מבקשים URL חתום מהשרת
      // (הוא גם קובע את הנתיב עצמו, לא מתקבל מהלקוח) ומעלים אליו ישירות -
      // הבייטים עצמם עדיין לא עוברים דרך שרת האפליקציה שלנו, בדיוק כמו קודם.
      const presignRes = await fetch(`/api/galleries/${galleryId}/photos/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!presignRes.ok) throw new Error('בקשת URL להעלאה נכשלה');
      const { path, uploadUrl } = await presignRes.json();

      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('העלאת הקובץ נכשלה');

      // ה-bucket ב-R2 פרטי - שומרים את הנתיב בתוכו, לא URL.
      // ה-URL בפועל (signed, זמני) נוצר רק כשלקוחה צופה בגלריה - ראו
      // app/api/gallery/[id]/route.ts. thumbnail_path מתחיל זהה ל-file_path
      // (נופל בחזרה למקור אם העיבוד למטה נכשל), ומוחלף בגרסה עם סימן מים
      // ברגע שה-route בצד שרת מסיים.
      const { data: photo, error: dbError } = await supabase
        .from('photos')
        .insert({
          gallery_id: galleryId,
          file_path: path,
          thumbnail_path: path,
          original_filename: file.name,
        })
        .select('id')
        .single();

      if (dbError) throw dbError;

      // התמונה כבר בטוחה ב-Storage וב-DB - זה מה שקובע "הועלה בהצלחה" מבחינת
      // הלקוחה/המכסה. עיבוד סימן המים לא מחכים לו יותר (fire-and-forget) - הוא
      // best-effort ממילא (אם נכשל, thumbnail_path נשאר המקור, ראו הערה למעלה),
      // אז אין סיבה שהתמונה הבאה בתור תחכה לו. זה הצעד שבאמת קיצר את הזמן
      // הכולל בהעלאה של הרבה תמונות - הורדה+שינוי גודל+הטבעה בצד שרת הם החלק
      // האיטי, לא ההעלאה עצמה.
      fetch(`/api/galleries/${galleryId}/photos/${photo.id}/process`, { method: 'POST' }).catch(() => {});

      updateGallery(galleryId, (prev) => ({
        ...prev,
        items: prev.items.map((it, idx) => (idx === i ? { ...it, status: 'done' } : it)),
      }));
    } catch (err: any) {
      // מגבלת חשבון חינמי (טריגר enforce_photo_limit ב-DB) - ראו supabase/schema.sql
      const message: string = err.message ?? 'שגיאה לא ידועה';
      const displayMessage = message.includes('LIMIT_PHOTOS')
        ? 'חשבון חינמי מוגבל ל-25 תמונות בגלריה'
        : message;
      updateGallery(galleryId, (prev) => ({
        ...prev,
        items: prev.items.map((it, idx) => (idx === i ? { ...it, status: 'error', error: displayMessage } : it)),
      }));
    }
  }

  const startUpload = useCallback(
    (galleryId: string) => {
      // קורא את הסטייט הנוכחי ישירות (לא מה-closure של הרנדר האחרון) כדי
      // שקריאה כפולה בטעות (למשל דאבל-קליק) לא תתחיל תור שני על אותה גלריה.
      setStates((prev) => {
        const current = prev[galleryId] ?? EMPTY_STATE;
        if (current.uploading || current.items.length === 0) return prev;

        const timer = fadeTimers.current[galleryId];
        if (timer) {
          clearTimeout(timer);
          delete fadeTimers.current[galleryId];
        }

        const items = current.items;

        // "מאגר עובדים" קטן: כל "עובד" מושך את האינדקס הבא בתור ומעלה אותו, עד
        // שנגמרים - כך יש תמיד עד UPLOAD_CONCURRENCY העלאות פעילות בו-זמנית,
        // בלי תזמון מסובך יותר מזה. ה-IIFE רץ בלי תלות בהמשך חיי רכיב כלשהו -
        // זה בדיוק העניין: הוא ממשיך גם אם דף ההעלאה עצמו יתפרק.
        (async () => {
          let nextIndex = 0;
          async function worker() {
            while (nextIndex < items.length) {
              const i = nextIndex++;
              await uploadOne(galleryId, i, items[i].file);
            }
          }
          await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, worker));

          updateGallery(galleryId, (p) => ({ ...p, uploading: false }));
          fadeTimers.current[galleryId] = setTimeout(() => {
            updateGallery(galleryId, (p) => ({ ...p, showBanner: false }));
            delete fadeTimers.current[galleryId];
          }, BANNER_FADE_MS);
        })();

        return { ...prev, [galleryId]: { ...current, uploading: true, showBanner: true } };
      });
    },
    [updateGallery] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const value: UploadContextValue = { states, setGalleryItems, setClientName, startUpload };

  // הגלריות שכרגע מציגות פס התקדמות צף - כולל קצת אחרי הסיום (showBanner
  // נשאר true עוד BANNER_FADE_MS), לא רק בזמן uploading ממש.
  const activeBanners = Object.entries(states).filter(([, s]) => s.showBanner);

  return (
    <UploadContext.Provider value={value}>
      {children}

      {activeBanners.length > 0 && (
        <div
          dir="rtl"
          style={{
            position: 'fixed', bottom: '1rem', left: '1rem', zIndex: 1000,
            display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 320,
          }}
        >
          {activeBanners.map(([galleryId, s]) => {
            const doneCount = s.items.filter((it) => it.status === 'done').length;
            const total = s.items.length;
            const namePart = s.clientName ? ` לגלריה של ${s.clientName}` : '';
            const label = s.uploading
              ? `מעלה תמונות${namePart}... (${doneCount}/${total})`
              : `ההעלאה${namePart} הושלמה (${doneCount}/${total})`;

            return (
              <button
                key={galleryId}
                onClick={() => router.push(`/dashboard/upload/${galleryId}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'right',
                  background: theme.panel, border: `1px solid ${theme.gold}`, color: theme.text,
                  borderRadius: 10, padding: '0.65rem 1rem', fontSize: 13, fontFamily: theme.fontSans,
                  cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                }}
              >
                <span style={{ color: theme.gold, flexShrink: 0 }}>{s.uploading ? '↑' : '✓'}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </UploadContext.Provider>
  );
}
