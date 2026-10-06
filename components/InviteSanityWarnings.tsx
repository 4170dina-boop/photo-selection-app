'use client';

import { useEffect, useState } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { createClient } from '@/lib/supabase/client';
import type { InviteWarning } from '@/lib/inviteSanity';

// תיבת אזהרות "רכות" לפני העתקה/שליחה של ההזמנה (lib/inviteSanity.ts) -
// רשימת מה שנראה לא תקין + "להעתיק בכל זאת" / ביטול. תופסת שורה מלאה
// (flexBasis 100%) כדי לשבת בתוך שורת כפתורים.
export default function InviteSanityWarnings({
  warnings,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  warnings: InviteWarning[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        flexBasis: '100%',
        width: '100%',
        boxSizing: 'border-box',
        background: theme.warningBg,
        color: theme.warningText,
        borderRadius: 8,
        padding: '0.7rem 1rem',
        fontSize: 13,
        marginTop: '0.25rem',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>רגע לפני ששולחים - כדאי לבדוק:</div>
      <ul style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.6 }}>
        {warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onConfirm}
          style={{ ...outlineButtonStyle, padding: '0.35rem 0.8rem', fontSize: 12.5, borderColor: theme.warningText, color: theme.warningText }}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} style={{ ...outlineButtonStyle, padding: '0.35rem 0.8rem', fontSize: 12.5 }}>
          ביטול
        </button>
      </div>
    </div>
  );
}

// כמה תמונות בגלריה וכמה מהן עדיין בעיבוד (thumbnail_path ריק = /process
// עוד לא סיים ליצור גרסה עם סימן מים - לא מוצגת ללקוחה). דרך לקוח הדפדפן עם
// ה-RLS של הצלמת. null = לא נטען (שגיאה) - הבדיקה מדלגת על מה שלא ידוע.
export function useGalleryPhotoCounts(galleryId: string): { photoCount: number | null; processingCount: number | null } {
  const [counts, setCounts] = useState<{ photoCount: number | null; processingCount: number | null }>({
    photoCount: null,
    processingCount: null,
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        const [all, processing] = await Promise.all([
          supabase.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId),
          supabase.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId).is('thumbnail_path', null),
        ]);
        if (cancelled) return;
        setCounts({
          photoCount: all.error ? null : all.count ?? null,
          processingCount: processing.error ? null : processing.count ?? null,
        });
      } catch {
        // נשאר null - בלי אזהרות על תמונות
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [galleryId]);

  return counts;
}
