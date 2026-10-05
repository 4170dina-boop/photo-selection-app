// "תמונות דומות" - קיבוץ רצפים (burst) של תמונות כמעט זהות, כדי שהלקוחה
// תבחר את הטובה ביותר מכל רצף במקום לעבור על 6 תמונות כמעט זהות בגריד.
//
// החתימה: dHash של 64 ביט (16 תווי hex) - מחושב פעם אחת בעיבוד מתמונת הגריד
// (lib/phash.ts, נשמר ב-photos.phash). שתי תמונות "דומות" כשמרחק Hamming
// בין החתימות קטן, ואם יש לשתיהן שעת צילום (photos.taken_at) - גם צולמו
// בהפרש של שניות ספורות. משווים רק תמונות עוקבות בציר הזמן (שרשרת), לא כל
// זוג - כך זה O(n) וגם לא מאחד תמונות דומות מחלקים שונים של האירוע.
//
// פונקציות טהורות - בשימוש בשרת (app/api/gallery/[id]/route.ts) ובטסטים.

export const BURST_MAX_DISTANCE = 10;
// בלי שעת צילום לאחת מהתמונות - דורשים דמיון חזק יותר, כי אין ראיה שזה רצף
export const BURST_MAX_DISTANCE_NO_TIME = 6;
export const BURST_MAX_GAP_SECONDS = 10;

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

// פיקסלים באפור (9x8, שורה אחרי שורה) -> 16 תווי hex. ביט = "השמאלי בהיר
// מהימני" בכל זוג שכנים בשורה (8 השוואות x 8 שורות = 64 ביט).
export function dhashFromGrey(pixels: ArrayLike<number>, width = DHASH_WIDTH, height = DHASH_HEIGHT): string {
  if (pixels.length < width * height) throw new Error('dhash: not enough pixels');
  let hex = '';
  let nibble = 0;
  let bitsInNibble = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[y * width + x];
      const right = pixels[y * width + x + 1];
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bitsInNibble++;
      if (bitsInNibble === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }
  return hex;
}

export function isValidHash(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[0-9a-f]{16}$/i.test(hash);
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// מרחק Hamming בין שתי חתימות hex באורך זהה. null אם אחת לא תקינה.
export function hammingDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!isValidHash(a) || !isValidHash(b)) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT_NIBBLE[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return distance;
}

export interface BurstCandidate {
  id: string;
  phash: string | null;
  // ISO או null
  takenAt: string | null;
}

export interface BurstOptions {
  maxDistance?: number;
  maxDistanceNoTime?: number;
  maxGapSeconds?: number;
}

// האם שתי תמונות עוקבות שייכות לאותו רצף.
export function isSimilarPair(a: BurstCandidate, b: BurstCandidate, options: BurstOptions = {}): boolean {
  const distance = hammingDistance(a.phash, b.phash);
  if (distance === null) return false;
  const ta = a.takenAt ? Date.parse(a.takenAt) : NaN;
  const tb = b.takenAt ? Date.parse(b.takenAt) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    const gapSeconds = Math.abs(tb - ta) / 1000;
    return gapSeconds <= (options.maxGapSeconds ?? BURST_MAX_GAP_SECONDS) && distance <= (options.maxDistance ?? BURST_MAX_DISTANCE);
  }
  return distance <= (options.maxDistanceNoTime ?? BURST_MAX_DISTANCE_NO_TIME);
}

// photos כבר בסדר ציר הזמן (ראו orderForTimeline ב-lib/chapters.ts). מחזיר
// רק רצפים של 2 תמונות ומעלה, כל אחד בסדר המקורי.
export function groupBursts(photos: BurstCandidate[], options: BurstOptions = {}): string[][] {
  const bursts: string[][] = [];
  let current: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    if (i > 0 && isSimilarPair(photos[i - 1], photos[i], options)) {
      current.push(photos[i].id);
    } else {
      if (current.length >= 2) bursts.push(current);
      current = [photos[i].id];
    }
  }
  if (current.length >= 2) bursts.push(current);
  return bursts;
}

// מזהה יציב לרצף (לא אינדקס): מזהה התמונה הראשונה בו.
export function burstIdByPhoto(bursts: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  bursts.forEach((ids) => ids.forEach((id) => map.set(id, ids[0])));
  return map;
}

// "הסתרת הדומות": מכל רצף נשארת תמונה אחת - הנבחרת (הראשונה מבין הנבחרות
// לפי סדר התצוגה) או, אם אין, הראשונה ברצף. תמונות שלא ברצף - תמיד מוצגות.
export function hideSimilarPhotos<T extends { id: string; burstId?: string | null }>(
  photos: T[],
  isSelected: (id: string) => boolean
): T[] {
  const representative = new Map<string, string>();
  for (const p of photos) {
    if (!p.burstId) continue;
    const current = representative.get(p.burstId);
    if (current === undefined) {
      representative.set(p.burstId, p.id);
    } else if (!isSelected(current) && isSelected(p.id)) {
      representative.set(p.burstId, p.id);
    }
  }
  return photos.filter((p) => !p.burstId || representative.get(p.burstId) === p.id);
}
