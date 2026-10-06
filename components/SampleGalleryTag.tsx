'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { theme } from '@/lib/theme';

// תג "דוגמה" לגלריית הדוגמה מאשף הפתיחה (galleries.is_sample). שאילתה אחת
// best-effort לכל הרשימה - אם העמודה עוד לא קיימת (מיגרציה בסוף
// supabase/schema.sql) פשוט אין תגים, ושום דבר אחר ברשימה לא נשבר.
export function useSampleGalleryIds(reloadKey?: unknown): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('galleries')
      .select('id')
      .eq('is_sample', true)
      .then(
        ({ data, error }) => {
          if (!cancelled && !error && data) setIds(new Set(data.map((r: { id: string }) => r.id)));
        },
        () => {}
      );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  return ids;
}

export default function SampleGalleryTag() {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 'normal',
        padding: '0.05rem 0.45rem',
        borderRadius: 999,
        background: theme.warningBg,
        color: theme.warningText,
        marginInlineStart: '0.4rem',
        verticalAlign: 'middle',
      }}
    >
      דוגמה
    </span>
  );
}
