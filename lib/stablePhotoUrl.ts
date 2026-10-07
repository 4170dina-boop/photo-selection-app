import { gridThumbKey, hasWatermarkedThumbnail, isKeyInGallery } from '@/lib/uploadPolicy';

// כתובת קבועה לכל תמונה בגלריה, במקום URL חתום של R2 שמשתנה בכל טעינה.
// הסיבה: סינוני אינטרנט (נטפרי ודומיו) מזהים תמונה לפי הכתובת שלה. URL חתום
// חדש בכל טעינה (X-Amz-Date/Signature משתנים) נראה לסינון כמו תמונה חדשה, אז
// אותה תמונה נשלחה לבדיקה שוב ושוב - אצל כל לקוחה ובכל כניסה. עם כתובת קבועה
// תמונה נבדקת פעם אחת, וכל מי שנכנס אחר כך (כולל הצלמת בבדיקה המוקדמת, ראו
// app/dashboard/galleries/[id]/filter-check) מקבל אותה כבר מאושרת.
// ההרשאה לא השתנתה: ה-route (app/api/gallery/[id]/img/[photoId]/[variant])
// בודק עוגיית גלריה או צלמת מחוברת לפני שהוא מחזיר את הקובץ.

export type PhotoVariant = 'grid' | 'full';

export function isPhotoVariant(value: unknown): value is PhotoVariant {
  return value === 'grid' || value === 'full';
}

export function stablePhotoUrl(galleryId: string, photoId: string, variant: PhotoVariant): string {
  return `/api/gallery/${encodeURIComponent(galleryId)}/img/${encodeURIComponent(photoId)}/${variant}`;
}

// אילו keys ב-R2 מתאימים לגרסה, לפי סדר עדיפות. grid נופל חזרה לתצוגה הגדולה
// לתמונות ישנות שאין להן גריד (בדיוק כמו thumbnailUrl: gridUrl ?? fullUrl קודם).
// המקור הנקי (file_path) לעולם לא מוחזר - רק thumbnail עם סימן מים.
export function photoKeysForVariant(
  galleryId: string,
  photo: { file_path: string; thumbnail_path: string | null },
  variant: PhotoVariant
): string[] {
  if (!hasWatermarkedThumbnail(photo)) return [];
  const full = photo.thumbnail_path as string;
  if (!isKeyInGallery(galleryId, full)) return [];
  if (variant === 'full') return [full];
  const grid = gridThumbKey(full);
  return grid && isKeyInGallery(galleryId, grid) ? [grid, full] : [full];
}
