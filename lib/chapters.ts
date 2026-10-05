// "פרקים" בגלריה (gallery_chapters + photos.chapter_id, ראו supabase/schema.sql):
// הצלמת מחלקת גלריה גדולה לחלקים עם שם ("💍 חופה", "💃 ריקודים"), והלקוחה
// מנווטת ביניהם בשורת צ'יפים מעל הגריד (components/GalleryNavBar.tsx).
//
// פונקציות טהורות - בשימוש בדף ההעלאה (components/ChaptersManager.tsx), ב-API
// ובטסטים. אין כאן גישה ל-DB.

export const CHAPTER_NAME_MAX_LENGTH = 60;
export const MAX_CHAPTERS_PER_GALLERY = 50;
export const DEFAULT_SPLIT_GAP_MINUTES = 30;

export interface Chapter {
  id: string;
  name: string;
  sort: number;
}

// שם פרק מגוף בקשה: חיתוך רווחים, רווחים כפולים לאחד, 1..60 תווים.
export function normalizeChapterName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || Array.from(name).length > CHAPTER_NAME_MAX_LENGTH) return null;
  return name;
}

export function sortChapters<T extends { sort: number; name: string }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
}

export interface TimelinePhoto {
  id: string;
  // ISO או null
  takenAt: string | null;
}

// החלק המינימלי של התמונות שצריך שעת צילום כדי שנסמוך על ציר הזמן שלהן.
// פחות מזה (למשל רוב התמונות הוקטנו לפני שהוספנו את קריאת ה-EXIF) - סדר ההעלאה.
export const MIN_CAPTURE_TIME_RATIO = 0.5;

// סדר ציר הזמן: לפי שעת הצילום אם לרוב התמונות יש אחת, אחרת סדר ההעלאה
// (הסדר שבו photos הגיע). תמונה בלי שעת צילום "יורשת" את השעה של התמונה
// שלפניה בסדר ההעלאה (או של הבאה, בתחילת הרשימה), כך שהיא נשארת ליד שכנותיה.
// effectiveTime = הזמן ששימש למיון (null כשאין ציר זמן בכלל).
export function orderForTimeline<T extends TimelinePhoto>(
  photos: T[]
): { ordered: { photo: T; time: number | null; hasOwnTime: boolean }[]; usedCaptureTime: boolean } {
  const times = photos.map((p) => (p.takenAt ? Date.parse(p.takenAt) : NaN));
  const withTime = times.filter((t) => Number.isFinite(t)).length;
  if (photos.length === 0 || withTime / photos.length < MIN_CAPTURE_TIME_RATIO) {
    return { ordered: photos.map((photo) => ({ photo, time: null, hasOwnTime: false })), usedCaptureTime: false };
  }

  const effective: number[] = new Array(photos.length);
  let last: number | null = null;
  for (let i = 0; i < photos.length; i++) {
    if (Number.isFinite(times[i])) last = times[i];
    effective[i] = last ?? NaN;
  }
  // תמונות בתחילת הרשימה בלי שעה - השעה של הראשונה שיש לה
  const firstKnown = times.find((t) => Number.isFinite(t)) as number;
  for (let i = 0; i < photos.length && !Number.isFinite(effective[i]); i++) effective[i] = firstKnown;

  const ordered = photos
    .map((photo, index) => ({ photo, index, time: effective[index], hasOwnTime: Number.isFinite(times[index]) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ photo, time, hasOwnTime }) => ({ photo, time, hasOwnTime }));
  return { ordered, usedCaptureTime: true };
}

export interface ProposedSplit {
  photoIds: string[];
  // ISO, או null כשאין שעת צילום
  startAt: string | null;
  endAt: string | null;
}

// "חלוקה אוטומטית לפי שעת צילום": פיצול בכל מקום שבו יש הפסקה של יותר מ-gapMinutes
// בין שתי תמונות עוקבות בציר הזמן. בלי שעות צילום (usedCaptureTime=false) -
// קבוצה אחת עם כל התמונות; הממשק מציע אז חלוקה שווה לפי סדר ההעלאה (splitEvenly).
export function proposeTimeSplits(
  photos: TimelinePhoto[],
  gapMinutes: number = DEFAULT_SPLIT_GAP_MINUTES
): { splits: ProposedSplit[]; usedCaptureTime: boolean } {
  const { ordered, usedCaptureTime } = orderForTimeline(photos);
  if (ordered.length === 0) return { splits: [], usedCaptureTime };
  if (!usedCaptureTime) {
    return { splits: [{ photoIds: ordered.map((o) => o.photo.id), startAt: null, endAt: null }], usedCaptureTime };
  }

  const gapMs = Math.max(1, gapMinutes) * 60 * 1000;
  const splits: ProposedSplit[] = [];
  let current: typeof ordered = [];
  const flush = () => {
    if (current.length === 0) return;
    splits.push({
      photoIds: current.map((o) => o.photo.id),
      startAt: new Date(current[0].time as number).toISOString(),
      endAt: new Date(current[current.length - 1].time as number).toISOString(),
    });
    current = [];
  };
  for (const item of ordered) {
    const prev = current[current.length - 1];
    if (prev && (item.time as number) - (prev.time as number) > gapMs) flush();
    current.push(item);
  }
  flush();
  return { splits, usedCaptureTime };
}

// חלוקה שווה ל-parts חלקים רציפים (לפי הסדר שהתקבל). חלקים ריקים לא מוחזרים.
export function splitEvenly(ids: string[], parts: number): string[][] {
  const n = Math.max(1, Math.min(Math.floor(parts) || 1, ids.length || 1));
  const result: string[][] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.round((i * ids.length) / n);
    const end = Math.round(((i + 1) * ids.length) / n);
    if (end > start) result.push(ids.slice(start, end));
  }
  return result;
}

// שם ברירת מחדל להצעה: "חלק 2 · 18:30–19:45" (שעון קיר של המצלמה, ראו lib/exifDate.ts).
export function defaultSplitName(index: number, split: Pick<ProposedSplit, 'startAt' | 'endAt'>): string {
  const label = `חלק ${index + 1}`;
  if (!split.startAt || !split.endAt) return label;
  const hhmm = (iso: string) => iso.slice(11, 16);
  const start = hhmm(split.startAt);
  const end = hhmm(split.endAt);
  return start === end ? `${label} · ${start}` : `${label} · ${start}–${end}`;
}

export interface ChapterProgress {
  id: string;
  name: string;
  total: number;
  viewed: number;
  selected: number;
  // צפתה בכל התמונות של הפרק
  done: boolean;
}

// התקדמות לכל פרק (רק פרקים עם תמונות), בסדר הפרקים.
export function chapterProgress(
  chapters: Chapter[],
  photos: { id: string; chapterId?: string | null }[],
  viewed: ReadonlySet<string>,
  isSelected: (id: string) => boolean
): ChapterProgress[] {
  const byChapter = new Map<string, { total: number; viewed: number; selected: number }>();
  for (const p of photos) {
    if (!p.chapterId) continue;
    const entry = byChapter.get(p.chapterId) ?? { total: 0, viewed: 0, selected: 0 };
    entry.total++;
    if (viewed.has(p.id)) entry.viewed++;
    if (isSelected(p.id)) entry.selected++;
    byChapter.set(p.chapterId, entry);
  }
  return sortChapters(chapters)
    .filter((c) => (byChapter.get(c.id)?.total ?? 0) > 0)
    .map((c) => {
      const entry = byChapter.get(c.id)!;
      return { id: c.id, name: c.name, ...entry, done: entry.viewed >= entry.total };
    });
}

// מסנן הפרק בגריד: 'all' = הכל, NO_CHAPTER = תמונות בלי פרק, אחרת מזהה פרק.
export const NO_CHAPTER = '__none__';

export function filterByChapter<T extends { chapterId?: string | null }>(photos: T[], chapterFilter: string): T[] {
  if (chapterFilter === 'all') return photos;
  if (chapterFilter === NO_CHAPTER) return photos.filter((p) => !p.chapterId);
  return photos.filter((p) => p.chapterId === chapterFilter);
}
