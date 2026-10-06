import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from './fetchAllPages';
import { isMissingColumnError } from './gender';

// "⭐ המלצת הצלמת" (photos.photographer_pick) - התמונות שהצלמת ממליצה עליהן.
// רק תג וסינון אצל הלקוחה; לא משפיע על בחירה, מכסה או חיוב.
// best-effort בדיוק כמו fetchGiftPhotos (lib/giftQueries.ts): אם המיגרציה עוד
// לא רצה - מתנהגים כאילו אין המלצות, ו-available=false מסתיר את הכפתור בדשבורד.
export async function fetchPickedPhotoIds(
  client: SupabaseClient,
  galleryId: string
): Promise<{ available: boolean; ids: Set<string> }> {
  try {
    const rows = await fetchAllPages<{ id: string }>((from, to) =>
      client
        .from('photos')
        .select('id')
        .eq('gallery_id', galleryId)
        .eq('photographer_pick', true)
        .order('id', { ascending: true })
        .range(from, to)
    );
    return { available: true, ids: new Set(rows.map((r) => r.id)) };
  } catch (error) {
    if (isMissingColumnError(error as { code?: string; message?: string })) {
      console.warn('[picks] photos.photographer_pick חסרה - אין המלצות עד שהמיגרציה תרוץ');
    } else {
      console.error('[picks] טעינת המלצות הצלמת נכשלה:', error);
    }
    return { available: false, ids: new Set() };
  }
}
