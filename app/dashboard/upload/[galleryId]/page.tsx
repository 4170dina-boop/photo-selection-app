'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle } from '@/lib/theme';

interface UploadPageProps {
  params: { galleryId: string };
}

interface UploadItem {
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
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
  const [existingPhotoCount, setExistingPhotoCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', galleryId)
      .then(({ count }) => setExistingPhotoCount(count ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

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

  async function handleUpload() {
    if (items.length === 0) return;

    setUploading(true);

    for (let i = 0; i < items.length; i++) {
      const { file } = items[i];
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'uploading' } : it)));

      try {
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

        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'processing' } : it)));

        // best-effort: אם ה-watermark נכשל, thumbnail_path כבר נופל בחזרה
        // למקור (app/api/galleries/[id]/photos/[photoId]/process/route.ts
        // פשוט לא מעדכן אותו) - לא חוסמים את ההעלאה בגלל זה.
        await fetch(`/api/galleries/${galleryId}/photos/${photo.id}/process`, { method: 'POST' }).catch(() => {});

        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'done' } : it)));
      } catch (err: any) {
        // מגבלת חשבון חינמי (טריגר enforce_photo_limit ב-DB) - ראו supabase/schema.sql
        const message: string = err.message ?? 'שגיאה לא ידועה';
        const displayMessage = message.includes('LIMIT_PHOTOS')
          ? 'חשבון חינמי מוגבל ל-25 תמונות בגלריה'
          : message;
        setItems((prev) =>
          prev.map((it, idx) => (idx === i ? { ...it, status: 'error', error: displayMessage } : it))
        );
      }
    }

    setUploading(false);
  }

  const doneCount = items.filter((it) => it.status === 'done').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
  const allProcessed = items.length > 0 && items.every((it) => it.status === 'done' || it.status === 'error');
  const totalPhotoCount = existingPhotoCount === null ? null : existingPhotoCount + doneCount;

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>העלאת תמונות לגלריה</h1>

      {totalPhotoCount !== null && (
        <p style={{ color: totalPhotoCount >= FREE_PHOTO_LIMIT ? theme.errorText : theme.textMuted, fontSize: 13, marginBottom: '1rem' }}>
          {totalPhotoCount}/{FREE_PHOTO_LIMIT} תמונות בגלריה (חשבון חינמי)
        </p>
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
                  {item.status === 'processing' && <span title="מטביעה סימן מים...">✨</span>}
                  {item.status === 'done' && <span style={{ color: theme.green }}>✓</span>}
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
