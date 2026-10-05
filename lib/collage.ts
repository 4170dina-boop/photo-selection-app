// קולאז' מתנה אוטומטי אחרי "סיימתי לבחור" (components/GiftCollage.tsx).
// כאן רק החשבון הטהור - בחירת התמונות, חלוקת התאים וחיתוך ה-cover - כדי שאפשר
// יהיה לבדוק אותו בלי canvas/דפדפן. הציור עצמו נעשה בקומפוננטה.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const COLLAGE_WIDTH = 1080;
export const COLLAGE_HEIGHT = 1350;
export const COLLAGE_MIN_PHOTOS = 3;
export const COLLAGE_MAX_PHOTOS = 6;
// כמה תמונות מתנה לכל היותר נכנסות לקולאז' - שלא ידחקו את מה שהיא בחרה בעצמה
export const COLLAGE_MAX_GIFTS = 2;

// אזורי הקנבס: כותרת עליונה (לוגו + שם העסק), אזור התמונות, ושורת תחתית
// ("הבחירה שלי ✨" + תאריך). כל המידות בפיקסלים של קנבס 1080×1350.
export const COLLAGE_PADDING = 48;
export const COLLAGE_HEADER_HEIGHT = 170;
export const COLLAGE_FOOTER_HEIGHT = 150;
export const COLLAGE_GAP = 14;

export function collagePhotoArea(): Rect {
  return {
    x: COLLAGE_PADDING,
    y: COLLAGE_HEADER_HEIGHT,
    w: COLLAGE_WIDTH - COLLAGE_PADDING * 2,
    h: COLLAGE_HEIGHT - COLLAGE_HEADER_HEIGHT - COLLAGE_FOOTER_HEIGHT,
  };
}

// k אינדקסים בפיזור שווה לאורך 0..n-1 (כולל הראשונה והאחרונה) - כדי שהקולאז'
// ייתן טעימה מכל הצילומים (התחלה, אמצע, סוף) ולא רק את הרצף הראשון.
export function evenlySpacedIndices(n: number, k: number): number[] {
  if (n <= 0 || k <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k === 1) return [Math.floor((n - 1) / 2)];
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (n - 1)) / (k - 1));
    if (out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

export interface CollageCandidates {
  selected: string[]; // מה שהיא בחרה, לפי סדר הגלריה
  gifts: string[]; // תמונות מתנה מהצלמת
  maybe?: string[]; // "אולי" - רק להשלמה אם אין מספיק נבחרות
}

// מחזירה סדר עדיפויות מלא: קודם עד max תמונות "ראשיות" (נבחרות בפיזור שווה +
// עד 2 מתנות), ואחריהן כל השאר כגיבוי - אם תמונה ראשית נכשלת בטעינה, הקומפוננטה
// לוקחת את הבאה בתור במקומה.
export function pickCollagePhotos(c: CollageCandidates, max = COLLAGE_MAX_PHOTOS): { primary: string[]; backups: string[] } {
  const seen = new Set<string>();
  const uniq = (ids: string[]) => ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const selected = uniq(c.selected);
  const gifts = uniq(c.gifts);
  const maybe = uniq(c.maybe ?? []);

  // מקום אחד למתנה אם יש כזו (גם כשבחרה הרבה), עד 2 כשאין מספיק נבחרות -
  // הרוב תמיד שייך למה שהיא בחרה בעצמה
  const giftCount =
    gifts.length === 0 || max <= 1
      ? 0
      : selected.length >= max - 1
        ? 1
        : Math.min(gifts.length, COLLAGE_MAX_GIFTS, max - selected.length);
  const selectedCount = Math.min(selected.length, max - giftCount);

  const pickedSelectedIdx = new Set(evenlySpacedIndices(selected.length, selectedCount));
  const pickedSelected = selected.filter((_, i) => pickedSelectedIdx.has(i));
  const pickedGifts = gifts.slice(0, giftCount);

  let primary = [...pickedSelected, ...pickedGifts];
  // עדיין חסר (מעט נבחרות ומעט/אין מתנות) - משלימים ממתנות נוספות ואז מ"אולי"
  const fill = [...gifts.filter((id) => !pickedGifts.includes(id)), ...maybe];
  let fillIdx = 0;
  while (primary.length < max && fillIdx < fill.length) primary.push(fill[fillIdx++]);
  primary = primary.slice(0, max);

  const primarySet = new Set(primary);
  const backups = [...selected, ...gifts, ...maybe].filter((id) => !primarySet.has(id));
  return { primary, backups };
}

// חלוקת אזור התמונות לתאים לפי מספר התמונות. firstIsPortrait משנה רק את
// הפריסה של 3 (תמונה גדולה לגובה בצד, או לרוחב למעלה).
export function collageCells(count: number, area: Rect = collagePhotoArea(), gap = COLLAGE_GAP, firstIsPortrait = false): Rect[] {
  const { x, y, w, h } = area;
  const col2 = (w - gap) / 2;

  const grid = (cols: number, rows: number, top: number, height: number): Rect[] => {
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (height - gap * (rows - 1)) / rows;
    const out: Rect[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // RTL: התא הראשון בכל שורה מימין
        out.push({ x: x + w - cw - c * (cw + gap), y: top + r * (ch + gap), w: cw, h: ch });
      }
    }
    return out;
  };

  switch (count) {
    case 1:
      return [{ ...area }];
    case 2: {
      const ch = (h - gap) / 2;
      return [
        { x, y, w, h: ch },
        { x, y: y + ch + gap, w, h: ch },
      ];
    }
    case 3: {
      if (firstIsPortrait) {
        // גדולה לגובה מימין, שתיים קטנות זו מעל זו משמאל
        const ch = (h - gap) / 2;
        return [
          { x: x + col2 + gap, y, w: col2, h },
          { x, y, w: col2, h: ch },
          { x, y: y + ch + gap, w: col2, h: ch },
        ];
      }
      const bigH = (h - gap) * 0.55;
      return [{ x, y, w, h: bigH }, ...grid(2, 1, y + bigH + gap, h - bigH - gap)];
    }
    case 4:
      return grid(2, 2, y, h);
    case 5: {
      // אחת גדולה למעלה + 2×2 קטנות מתחת
      const bigH = (h - gap * 2) * 0.42;
      return [{ x, y, w, h: bigH }, ...grid(2, 2, y + bigH + gap, h - bigH - gap)];
    }
    default:
      // 6 (ומעלה - נחתך ל-6): 2 עמודות × 3 שורות, מתאים לקנבס לאורך
      return grid(2, 3, y, h);
  }
}

// שיבוץ תמונות לתאים: התמונה הכי "לרוחב" לתא הכי רחב וכן הלאה, כדי שחיתוך ה-cover
// יוריד כמה שפחות מכל תמונה. מחזירה לכל תא את אינדקס התמונה שלו.
export function assignPhotosToCells(cells: Rect[], aspects: number[]): number[] {
  const n = Math.min(cells.length, aspects.length);
  const cellOrder = cells
    .slice(0, n)
    .map((c, i) => ({ i, a: c.w / c.h }))
    .sort((p, q) => q.a - p.a || p.i - q.i);
  const photoOrder = aspects
    .slice(0, n)
    .map((a, i) => ({ i, a }))
    .sort((p, q) => q.a - p.a || p.i - q.i);
  const result = new Array<number>(n);
  cellOrder.forEach((cell, k) => {
    result[cell.i] = photoOrder[k].i;
  });
  return result;
}

// מקבילה ל-object-fit: cover - איזה מלבן מתוך התמונה המקורית לצייר כדי למלא
// תא בגודל dstW×dstH בלי עיוות, ממורכז.
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, w: Math.max(0, srcW), h: Math.max(0, srcH) };
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // התמונה רחבה יותר מהתא - חותכים מהצדדים
    const w = srcH * dstAspect;
    return { x: (srcW - w) / 2, y: 0, w, h: srcH };
  }
  const h = srcW / dstAspect;
  // חיתוך מעט מעל המרכז (40%) - בפורטרטים הפנים בדרך כלל בשליש העליון
  return { x: 0, y: (srcH - h) * 0.4, w: srcW, h };
}

// "הקולאז-שלי-<שם>.jpg" - בלי תווים שאסורים בשמות קבצים (Windows/iOS), בלי
// גרש (שובר חלק מתוכנות ההורדה), רווחים הופכים למקפים.
export function collageFileName(name: string | null | undefined): string {
  const clean = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*'`׳״]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return clean ? `הקולאז-שלי-${clean}.jpg` : 'הקולאז-שלי.jpg';
}
