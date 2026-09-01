'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle } from '@/lib/theme';

interface UploadPageProps {
  params: { galleryId: string };
}

interface UploadItem {
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface ExistingPhoto {
  id: string;
  thumbnailUrl: string | null;
  original_filename: string;
  status: 'maybe' | 'selected' | null;
  note: string | null;
}

// תואם ל-enforce_photo_limit ב-supabase/schema.sql - אין מקור אמת משותף אחד,
// אז אם המספר שם משתנה צריך לעדכן גם כאן. זה רק לתצוגה מקדימה; האכיפה בפועל
// היא ה-trigger ב-DB, לא זה.
const FREE_PHOTO_LIMIT = 25;

export default function UploadPage({ params }: UploadPageProps) {
  const { galleryId } = params;

  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[] | null>(null);
  const [checkingOwnership, setCheckingOwnership] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // מוודאים שהגלריה שייכת לצלמת המחוברת (אותו דפוס כמו דף העריכה) לפני שמציגים
  // את ממשק ההעלאה - בלי זה, כל צלמת יכולה לנווט לפי galleryId של גלריה של
  // צלמת אחרת ולראות ממשק העלאה שלא באמת עובד (ה-RLS חוסם את הכתיבה בפועל,
  // אבל בלי הבדיקה הזו זה מרגיש שבור במקום שיגיד בבירור "לא נמצא").
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/galleries/${galleryId}`);
      if (!res.ok) {
        setNotFound(true);
        setCheckingOwnership(false);
        return;
      }
      setCheckingOwnership(false);
      await loadExistingPhotos();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  async function loadExistingPhotos() {
    const res = await fetch(`/api/galleries/${galleryId}/review`);
    if (!res.ok) return;
    const data = await res.json();
    setExistingPhotos(data.photos ?? []);
  }

  // מנקה object URLs של תצוגה מקדימה כשעוזבים את הדף, כדי לא לדלוף זיכרון
  useEffect(() => {
    return () => {
      items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems(selected.map((file) => ({ file, previewUrl: URL.createObjectURL(file), status: 'pending' })));
  }

  // בחירת תיקייה שלמה (webkitdirectory) לא תומכת ב-accept="image/*" - הדפדפן
  // מחזיר את כל הקבצים בתיקייה (כולל למשל .DS_Store), אז מסננים ידנית לפי
  // סוג הקובץ בפועל אחרי הבחירה.
  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems(selected.map((file) => ({ file, previewUrl: URL.createObjectURL(file), status: 'pending' })));
  }

  // כמה תמונות מעלים בו-זמנית. קודם זה היה אחת-אחת (תור) - עכשיו גם לא
  // מחכים יותר לעיבוד סימן המים לפני שעוברים לתמונה הבאה (ראו הערה למטה),
  // אז שלב ההעלאה עצמו (Storage + DB) מהיר בהרבה, ואפשר להעלות יותר תמונות
  // בו-זמנית בלי לחשוש שכל "עובד" תקוע מחכה לעיבוד איטי בצד שרת.
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

  async function uploadOne(i: number) {
    const originalFile = items[i].file;
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'uploading' } : it)));

    try {
      const file = await compressForUpload(originalFile);
      // נתיב ייחודי בתוך ה-bucket, מסודר לפי גלריה
      const path = `${galleryId}/${crypto.randomUUID()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from('gallery-photos')
        .upload(path, file, { upsert: false });

      if (uploadError) throw uploadError;

      // ה-bucket פרטי (לא public) - שומרים את הנתיב בתוך ה-bucket, לא URL.
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

      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'done' } : it)));
    } catch (err: any) {
      // מגבלת חשבון חינמי (טריגר enforce_photo_limit ב-DB) - ראו supabase/schema.sql
      const message: string = err.message ?? 'שגיאה לא ידועה';
      const displayMessage = message.includes('LIMIT_PHOTOS')
        ? 'חשבון חינמי מוגבל ל-25 תמונות בגלריה'
        : message;
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'error', error: displayMessage } : it)));
    }
  }

  async function handleUpload() {
    if (items.length === 0) return;

    setUploading(true);

    // "מאגר עובדים" קטן: כל "עובד" מושך את האינדקס הבא בתור ומעלה אותו, עד
    // שנגמרים - כך יש תמיד עד UPLOAD_CONCURRENCY העלאות פעילות בו-זמנית,
    // בלי תזמון מסובך יותר מזה.
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < items.length) {
        const i = nextIndex++;
        await uploadOne(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, worker));

    setUploading(false);
    await loadExistingPhotos(); // רענון סקירת התמונות הקיימות עם החדשות שהתווספו
  }

  const doneCount = items.filter((it) => it.status === 'done').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
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
          <h2 style={{ fontFamily: theme.fontSerif, fontSize: 16, marginBottom: '0.75rem' }}>
            סקירת תמונות ({existingPhotos.length})
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {existingPhotos.map((photo) => {
              const borderColor =
                photo.status === 'selected' ? theme.gold : photo.status === 'maybe' ? theme.green : theme.border;
              const statusLabel = photo.status === 'selected' ? 'נבחר' : photo.status === 'maybe' ? 'אולי' : null;

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
                    style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }}
                  />
                  {statusLabel && (
                    <span
                      style={{
                        position: 'absolute', top: 6, left: 6,
                        background: photo.status === 'selected' ? theme.gold : theme.green,
                        color: theme.goldText, fontSize: 10, fontWeight: 'bold',
                        padding: '2px 7px', borderRadius: 10,
                      }}
                    >
                      {statusLabel}
                    </span>
                  )}
                  {photo.note && (
                    <div
                      title={photo.note}
                      style={{
                        position: 'absolute', bottom: 0, insetInline: 0,
                        background: 'rgba(0,0,0,0.65)', color: theme.text, fontSize: 10,
                        padding: '3px 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      ✎ {photo.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <label style={{ ...goldButtonStyle, display: 'inline-block' }}>
          בחירת תמונות
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>

        <label
          style={{
            display: 'inline-block', padding: '0.6rem 1.1rem', borderRadius: 8,
            border: `1px solid ${theme.border}`, color: theme.text, cursor: uploading ? 'default' : 'pointer',
            opacity: uploading ? 0.6 : 1,
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
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>

        {items.length > 0 && (
          <span style={{ color: theme.textMuted }}>{items.length} קבצים נבחרו</span>
        )}

        {items.length > 0 && (
          <button
            onClick={handleUpload}
            disabled={uploading || items.length === 0}
            style={{
              ...goldButtonStyle,
              background: 'transparent',
              border: `1px solid ${theme.gold}`,
              color: theme.gold,
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? `מעלה... (${doneCount}/${items.length})` : 'העלה תמונות'}
          </button>
        )}
      </div>

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
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                borderRadius: 10,
                overflow: 'hidden',
                border: `2px solid ${item.status === 'error' ? theme.errorText : item.status === 'done' ? theme.green : theme.border}`,
                background: theme.panel,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt={item.file.name}
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

              {item.status === 'error' && item.error && (
                <div style={{ position: 'absolute', top: 0, insetInline: 0, background: theme.errorBg, color: theme.errorText, fontSize: 11, padding: '4px 8px' }}>
                  {item.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
