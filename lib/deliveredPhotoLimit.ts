import { FREE_PHOTO_LIMIT } from './uploadPolicy';

// מגבלת חשבון חינמי לתמונות סופיות (delivered_photos). בחשבון חינמי יש עד
// FREE_PHOTO_LIMIT (25) תמונות מקור בגלריה, אז גם הבחירה + המתנות לא יכולות
// לעבור את זה - ומעליה מרווח קטן של 5 לגרסאות נוספות (למשל צבע + שחור-לבן
// לתמונה אחת). קבוע ולא "included_photos + מתנות" בכוונה: כך הטריגר ב-DB
// (enforce_delivered_photo_limit ב-supabase/schema.sql) פשוט ולא תלוי
// בחבילה שהצלמת יכולה לשנות. אם המספר משתנה - לעדכן גם שם.
export const FREE_DELIVERED_PHOTO_LIMIT = FREE_PHOTO_LIMIT + 5;

export const DELIVERED_LIMIT_MESSAGE = `LIMIT_DELIVERED_PHOTOS: חשבון חינמי מוגבל ל-${FREE_DELIVERED_PHOTO_LIMIT} תמונות סופיות בגלריה`;

// כמה תמונות סופיות עוד אפשר להוסיף. null = ללא הגבלה (is_unlimited).
export function remainingDeliveredQuota(currentCount: number, isUnlimited: boolean): number | null {
  if (isUnlimited) return null;
  return Math.max(0, FREE_DELIVERED_PHOTO_LIMIT - Math.max(0, currentCount));
}
