import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from './fetchAllPages';
import { isMissingColumnError } from './gender';

export interface GiftPhotoRow {
  id: string;
  gallery_id: string;
  gift_message: string | null;
  original_filename: string;
  file_path: string;
}

// כמה מזהי גלריות בכל שאילתת .in() - רשימה ארוכה מדי נכנסת ל-URL של
// PostgREST (GET) ונכשלת (414/400) אצל צלמת עם מאות גלריות.
export const GIFT_QUERY_GALLERY_BATCH = 100;

export function chunkIds<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// כל תמונות המתנה (photos.is_gift, ראו lib/gifts.ts) בגלריות הנתונות - בבאצ'ים
// של GIFT_QUERY_GALLERY_BATCH גלריות, וכל באץ' עם pagination (lib/fetchAllPages.ts)
// כדי לא להיחתך ב-1000 שורות. best-effort בכוונה, אותו דפוס כמו sharpness_score
// ב-app/api/gallery/[id]/route.ts: אם המיגרציה של is_gift עוד לא רצה, השאילתה
// נכשלת ואנחנו פשוט מתנהגים כאילו אין מתנות - לא מפילים טעינת גלריה/דשבורד/ייצוא.
// אבל שגיאה *נרשמת ללוג* (לא נבלעת בשקט) - מתנה שלא נטענה נספרת לחיוב.
//
// עובד גם עם client של session (דשבורד, RLS מגביל לגלריות של הצלמת) וגם עם
// service_role (צד הלקוחה, אחרי אימות session הגלריה).
export async function fetchGiftPhotos(client: SupabaseClient, galleryIds: string[]): Promise<GiftPhotoRow[]> {
  const ids = Array.from(new Set(galleryIds.filter(Boolean)));
  if (ids.length === 0) return [];
  try {
    const batches = await Promise.all(
      chunkIds(ids, GIFT_QUERY_GALLERY_BATCH).map((batch) =>
        fetchAllPages<GiftPhotoRow>((from, to) =>
          client
            .from('photos')
            .select('id, gallery_id, gift_message, original_filename, file_path')
            .in('gallery_id', batch)
            .eq('is_gift', true)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      )
    );
    return batches.flat();
  } catch (error) {
    // עמודה חסרה = מיגרציה שלא רצה - מצב צפוי, אזהרה בלבד
    if (isMissingColumnError(error as { code?: string; message?: string })) {
      console.warn('[gifts] photos.is_gift חסרה - מתעלמים מתמונות מתנה עד שהמיגרציה תרוץ');
    } else {
      console.error('[gifts] טעינת תמונות המתנה נכשלה:', error);
    }
    return [];
  }
}
