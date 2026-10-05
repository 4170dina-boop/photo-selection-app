'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { theme } from '@/lib/theme';
import { FREE_PHOTO_LIMIT, indicesToUpload, mapWithConcurrency } from '@/lib/uploadPolicy';
import { createMicroBatcher } from '@/lib/microBatch';
import { prepareForUpload } from './uploadCompressor';
import { readTakenAtFromFile } from '@/lib/exifDate';

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
  startUpload: (galleryId: string, options?: StartUploadOptions) => void;
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
    startUpload: useCallback((options?: StartUploadOptions) => ctx.startUpload(galleryId, options), [ctx, galleryId]),
  };
}

// כמה תמונות מעלים בו-זמנית. קודם זה היה אחת-אחת (תור) - עכשיו גם לא מחכים
// יותר לעיבוד סימן המים לפני שעוברים לתמונה הבאה (ראו הערה ב-uploadOne), אז
// שלב ההעלאה עצמו (Storage + DB) מהיר בהרבה, ואפשר להעלות יותר תמונות בו-זמנית
// בלי לחשוש שכל "עובד" תקוע מחכה לעיבוד איטי בצד שרת. 8 ולא 6 (מגבלת
// החיבורים של דפדפן ל-host אחד ב-HTTP/1.1) בכוונה: כל "עובד" מבלה חלק מהזמן
// בהקטנה ובבקשות presign/רישום מול השרת שלנו (host אחר), לא רק ב-PUT ל-R2,
// ו-R2 עונה ב-HTTP/2 ממילא. יותר מזה לא עוזר - ההעלאה מוגבלת ברוחב הפס.
const UPLOAD_CONCURRENCY = 8;

// בקשות presign/רישום מאוגדות (lib/microBatch.ts): במקום בקשה לכל תמונה (כל
// אחת עם auth + שאילתות בעלות משלה), בקשה אחת לכמה תמונות שמגיעות ביחד.
// ההמתנה הקצרה זניחה לעומת זמן ההעלאה עצמה.
const BATCH_MAX_SIZE = 10;
const BATCH_DELAY_MS = 80;

interface PresignResult {
  path?: string;
  uploadUrl?: string;
  contentType?: string;
  error?: string;
}

interface RegisterResult {
  id?: string;
  error?: string;
}

async function postBatch<T>(url: string, files: unknown[], fallbackError: string): Promise<T[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? fallbackError);
  return data.results;
}

function createGalleryBatchers(galleryId: string) {
  return {
    presign: createMicroBatcher<{ contentType: string; size: number }, PresignResult>({
      maxSize: BATCH_MAX_SIZE,
      delayMs: BATCH_DELAY_MS,
      run: (files) => postBatch(`/api/galleries/${galleryId}/photos/presign-upload`, files, 'בקשת URL להעלאה נכשלה'),
    }),
    register: createMicroBatcher<{ path: string; originalFilename: string; takenAt?: string | null }, RegisterResult>({
      maxSize: BATCH_MAX_SIZE,
      delayMs: BATCH_DELAY_MS,
      run: (files) => postBatch(`/api/galleries/${galleryId}/photos`, files, 'שמירת התמונה נכשלה'),
    }),
  };
}

export interface StartUploadOptions {
  // העלאת הקובץ המקורי כמו שהוא, בלי הקטנה ל-UPLOAD_MAX_EDGE (lib/uploadResize.ts) -
  // רק למי שצריכה את הקבצים המלאים בחזרה מהשרת (הורדת ZIP בכפתור הקסם).
  fullResolution?: boolean;
}

// כמה זמן פס ההתקדמות הצף נשאר מוצג אחרי שההעלאה לגלריה מסתיימת, לפני שהוא
// נעלם - אותו דפוס של הודעות זמניות שכבר קיים בדשבורד (setTimeout שמכבה state,
// ראו למשל setShowCelebration/setCopied בדפים אחרים).
const BANNER_FADE_MS = 5000;

export function UploadProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
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

  async function uploadOne(
    galleryId: string,
    i: number,
    originalFile: File,
    batchers: ReturnType<typeof createGalleryBatchers>,
    options: StartUploadOptions
  ) {
    updateGallery(galleryId, (prev) => ({
      ...prev,
      items: prev.items.map((it, idx) => (idx === i ? { ...it, status: 'uploading' } : it)),
    }));

    try {
      // הקטנה ל-3000px בצלע הארוכה (ראו lib/uploadResize.ts) ב-Web Worker -
      // קובץ מצלמה של ~10MB הופך ל-~1-2MB, והדף לא קופא בזמן הפענוח.
      // "עובדים" אחרים מעלים בזמן שהתמונה הזו מוקטנת.
      // שעת הצילום (EXIF) נקראת מהמקור לפני ההקטנה - הקנבס מוחק את ה-EXIF
      // (ראו lib/exifDate.ts). משמשת לחלוקה לפרקים ולזיהוי תמונות דומות.
      const [file, takenAt] = await Promise.all([
        prepareForUpload(originalFile, !!options.fullResolution),
        readTakenAtFromFile(originalFile),
      ]);

      // אחסון עבר ל-Cloudflare R2 (ראו lib/r2.ts) - ל-R2 (כמו S3) אין מקבילה
      // ל-RLS שמאפשרת לדפדפן להעלות ישירות בבטחה, אז מבקשים URL חתום מהשרת
      // (הוא גם קובע את הנתיב עצמו, לא מתקבל מהלקוח) ומעלים אליו ישירות -
      // הבייטים עצמם עדיין לא עוברים דרך שרת האפליקציה שלנו, בדיוק כמו קודם.
      // סוג התוכן והגודל נחתמים לתוך ה-URL (ראו lib/r2.ts) - השרת מאמת אותם
      // (רשימת סוגים מותרים + גודל מקסימלי) ובודק את מכסת התמונות לפני החתימה.
      const presignData = await batchers.presign({ contentType: file.type, size: file.size });
      if (presignData.error || !presignData.path || !presignData.uploadUrl) {
        throw new Error(presignData.error ?? 'בקשת URL להעלאה נכשלה');
      }
      const { path, uploadUrl, contentType } = presignData;

      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType ?? file.type } });
      if (!putRes.ok) throw new Error('העלאת הקובץ נכשלה');

      // הרישום ב-DB קורה בצד שרת (app/api/galleries/[id]/photos/route.ts) - אם
      // הוא נכשל (למשל מגבלת התמונות), השרת גם מוחק את הקובץ מ-R2 כדי שלא
      // יישאר יתום. thumbnail_path נשאר null עד שהעיבוד למטה מסיים - עד אז
      // התמונה לא מוצגת ללקוחה בכלל (אף פעם לא המקור הנקי).
      const registerData = await batchers.register({ path, originalFilename: file.name, takenAt });
      if (registerData.error || !registerData.id) throw new Error(registerData.error ?? 'שמירת התמונה נכשלה');
      const photo = { id: registerData.id };

      // התמונה כבר בטוחה ב-Storage וב-DB - זה מה שקובע "הועלה בהצלחה" מבחינת
      // הלקוחה/המכסה. עיבוד סימן המים לא מחכים לו (fire-and-forget) - אם הוא
      // נכשל, התמונה פשוט נשארת מוסתרת מהלקוחה, ודף ההעלאה מפעיל אותו מחדש
      // (ראו photosNeedingProcessRetry ב-lib/uploadPolicy.ts). זה הצעד שבאמת
      // קיצר את הזמן הכולל בהעלאה של הרבה תמונות - הורדה+שינוי גודל+הטבעה בצד שרת הם החלק
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
        ? `חשבון חינמי מוגבל ל-${FREE_PHOTO_LIMIT} תמונות בגלריה`
        : message;
      updateGallery(galleryId, (prev) => ({
        ...prev,
        items: prev.items.map((it, idx) => (idx === i ? { ...it, status: 'error', error: displayMessage } : it)),
      }));
    }
  }

  const startUpload = useCallback(
    (galleryId: string, options: StartUploadOptions = {}) => {
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
        // רק pending/error - פריט שכבר הועלה (done) לא נשלח שוב בלחיצה חוזרת,
        // אחרת "נסי שוב" אחרי כישלון חלקי יוצר כפילויות של כל מה שכבר הצליח.
        const queue = indicesToUpload(items);
        if (queue.length === 0) return prev;

        // "מאגר עובדים" קטן: עד UPLOAD_CONCURRENCY העלאות פעילות בו-זמנית.
        // ה-IIFE רץ בלי תלות בהמשך חיי רכיב כלשהו - זה בדיוק העניין: הוא ממשיך
        // גם אם דף ההעלאה עצמו יתפרק.
        const batchers = createGalleryBatchers(galleryId);
        (async () => {
          await mapWithConcurrency(queue, UPLOAD_CONCURRENCY, (i) =>
            uploadOne(galleryId, i, items[i].file, batchers, options)
          );

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
