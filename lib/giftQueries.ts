import type { SupabaseClient } from '@supabase/supabase-js';

export interface GiftPhotoRow {
  id: string;
  gallery_id: string;
  gift_message: string | null;
  original_filename: string;
  file_path: string;
}

// כל תמונות המתנה (photos.is_gift, ראו lib/gifts.ts) בגלריות הנתונות - שאילתה
// אחת לכל הגלריות. best-effort בכוונה, אותו דפוס כמו sharpness_score ב-
// app/api/gallery/[id]/route.ts: אם המיגרציה של is_gift עוד לא רצה, השאילתה
// נכשלת ואנחנו פשוט מתנהגים כאילו אין מתנות - לא מפילים טעינת גלריה/דשבורד/ייצוא.
//
// עובד גם עם client של session (דשבורד, RLS מגביל לגלריות של הצלמת) וגם עם
// service_role (צד הלקוחה, אחרי אימות session הגלריה).
export async function fetchGiftPhotos(client: SupabaseClient, galleryIds: string[]): Promise<GiftPhotoRow[]> {
  if (galleryIds.length === 0) return [];
  try {
    const { data, error } = await client
      .from('photos')
      .select('id, gallery_id, gift_message, original_filename, file_path')
      .in('gallery_id', galleryIds)
      .eq('is_gift', true)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data as GiftPhotoRow[];
  } catch {
    return [];
  }
}
