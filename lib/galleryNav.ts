// סינוני הניווט בגריד של הלקוחה (פרקים + "הסתרת הדומות") - מעל הסינון הקיים
// של app/gallery/[id]/page.tsx ("נבחרו"/"אולי"/"בוחרים ביחד"). טהור, לבדיקה ב-vitest.

import { filterByChapter } from './chapters';
import { hideSimilarPhotos } from './bursts';

export interface NavPhoto {
  id: string;
  chapterId?: string | null;
  burstId?: string | null;
}

export function applyNavFilters<T extends NavPhoto>(
  photos: T[],
  options: { chapterFilter: string; hideSimilar: boolean; isSelected: (id: string) => boolean }
): T[] {
  const inChapter = filterByChapter(photos, options.chapterFilter);
  return options.hideSimilar ? hideSimilarPhotos(inChapter, options.isSelected) : inChapter;
}

// burstId -> כל התמונות ברצף, בסדר התצוגה.
export function burstMembers<T extends NavPhoto>(photos: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const p of photos) {
    if (!p.burstId) continue;
    const list = map.get(p.burstId) ?? [];
    list.push(p);
    map.set(p.burstId, list);
  }
  // רצף שרק תמונה אחת ממנו מוצגת ללקוחה (השאר עוד לא עובדו) - לא רצף
  map.forEach((list, key) => {
    if (list.length < 2) map.delete(key);
  });
  return map;
}
