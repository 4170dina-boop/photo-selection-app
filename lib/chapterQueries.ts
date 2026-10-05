// שאילתות DB לפרקים / שעת צילום / חתימות דמיון (ראו lib/chapters.ts, lib/bursts.ts).
// כולן best-effort: עד שמריצים את המיגרציה ב-supabase/schema.sql הטבלה
// gallery_chapters והעמודות photos.chapter_id/taken_at/phash לא קיימות - ואז
// מחזירים "לא זמין" במקום להפיל את הגלריה או את דף ההעלאה.

import { isMissingColumnError } from './gender';
import { sortChapters, type Chapter } from './chapters';

// טיפוס מינימלי במכוון - מתאים גם ל-service_role וגם ללקוח עם session (כמו lib/gender.ts).
interface SupabaseLike {
  from: (table: string) => any;
}

type DbError = { code?: string | null; message?: string | null } | null | undefined;

// טבלה חסרה (42P01 / PGRST205) או עמודה חסרה (42703 / PGRST204).
export function isMissingChapterSchemaError(error: DbError): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  if (isMissingColumnError(error)) return true;
  const msg = error.message ?? '';
  return /gallery_chapters/.test(msg) && /(does not exist|could not find)/i.test(msg);
}

export interface PhotoNavFields {
  chapterId: string | null;
  takenAt: string | null;
  phash: string | null;
}

// PostgREST שם את מסנן ה-in ב-URL - מחלקים לקבוצות כדי לא לחרוג מאורך URL.
export const IN_FILTER_CHUNK = 150;

export function chunk<T>(items: T[], size = IN_FILTER_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// chapter_id / taken_at / phash לכל תמונה בגלריה. available=false = המיגרציה לא רצה.
export async function fetchPhotoNavFields(
  supabase: SupabaseLike,
  galleryId: string
): Promise<{ available: boolean; byPhoto: Map<string, PhotoNavFields> }> {
  const byPhoto = new Map<string, PhotoNavFields>();
  try {
    // עד 10,000 תמונות - מעבר למגבלת ברירת המחדל של PostgREST (1000 שורות)
    const pageSize = 1000;
    for (let from = 0; from < 10000; from += pageSize) {
      const { data, error } = await supabase
        .from('photos')
        .select('id, chapter_id, taken_at, phash')
        .eq('gallery_id', galleryId)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { available: !isMissingChapterSchemaError(error), byPhoto };
      (data ?? []).forEach((row: any) =>
        byPhoto.set(row.id, { chapterId: row.chapter_id ?? null, takenAt: row.taken_at ?? null, phash: row.phash ?? null })
      );
      if (!data || data.length < pageSize) break;
    }
    return { available: true, byPhoto };
  } catch {
    return { available: false, byPhoto };
  }
}

export async function fetchChapters(
  supabase: SupabaseLike,
  galleryId: string
): Promise<{ available: boolean; chapters: Chapter[] }> {
  try {
    const { data, error } = await supabase
      .from('gallery_chapters')
      .select('id, name, sort')
      .eq('gallery_id', galleryId);
    if (error) return { available: !isMissingChapterSchemaError(error), chapters: [] };
    return {
      available: true,
      chapters: sortChapters((data ?? []).map((c: any) => ({ id: c.id, name: c.name, sort: c.sort ?? 0 }))),
    };
  } catch {
    return { available: false, chapters: [] };
  }
}

// שיוך תמונות לפרק (או null = בלי פרק), רק בתוך הגלריה. מחזיר כמה עודכנו.
export async function assignPhotosToChapter(
  supabase: SupabaseLike,
  galleryId: string,
  photoIds: string[],
  chapterId: string | null
): Promise<{ ok: true; updated: number } | { ok: false; missingSchema: boolean }> {
  let updated = 0;
  for (const ids of chunk(photoIds)) {
    const { data, error } = await supabase
      .from('photos')
      .update({ chapter_id: chapterId })
      .eq('gallery_id', galleryId)
      .in('id', ids)
      .select('id');
    if (error) return { ok: false, missingSchema: isMissingChapterSchemaError(error) };
    updated += (data ?? []).length;
  }
  return { ok: true, updated };
}

// photoIds מגוף בקשה: מערך של מחרוזות uuid, בלי כפילויות, עד max.
export function parsePhotoIds(value: unknown, max = 5000): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string' || !uuid.test(v)) return null;
    ids.add(v);
  }
  return Array.from(ids);
}
