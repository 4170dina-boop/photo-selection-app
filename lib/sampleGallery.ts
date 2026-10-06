// "גלריית דוגמה" (POST app/api/galleries/sample) - לוגיקה טהורה: פרטי הגלריה,
// תוקף, ובניית ה-SVG של תמונות הדמה. ההמרה ל-JPEG (sharp) נמצאת ב-
// lib/sampleGalleryImages.ts, כדי שהקובץ הזה יישאר בלי תלויות native.

export const SAMPLE_CLIENT_NAME = 'גלריית דוגמה';
export const SAMPLE_PHOTO_COUNT = 8;
export const SAMPLE_EXPIRY_DAYS = 14;
// חבילה קטנה - מספיק כדי להרגיש את חוויית "בחרת 3 מתוך 3" ואת התוספת
export const SAMPLE_INCLUDED_PHOTOS = 3;

export const SAMPLE_IMAGE_WIDTH = 1600;
export const SAMPLE_IMAGE_HEIGHT = 1067;

const DAY_MS = 24 * 60 * 60 * 1000;

export function sampleExpiryIso(nowMs: number): string {
  return new Date(nowMs + SAMPLE_EXPIRY_DAYS * DAY_MS).toISOString();
}

// מחירי החבילה לדוגמה: אם לצלמת כבר יש מחירי ברירת מחדל - משתמשים בהם, כדי
// שהדוגמה תראה לה בדיוק מה הלקוחה תראה. ערך לא תקין -> 0.
export function samplePackage(defaults: { default_base_price?: unknown; default_extra_photo_price?: unknown } | null) {
  const num = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    included_photos: SAMPLE_INCLUDED_PHOTOS,
    base_price: num(defaults?.default_base_price),
    extra_photo_price: num(defaults?.default_extra_photo_price),
  };
}

// כמה תמונות דוגמה אפשר בפועל - לפי מכסת החשבון החינמי (remainingPhotoQuota
// ב-lib/uploadPolicy.ts; null = ללא הגבלה).
export function samplePhotoCount(remaining: number | null): number {
  if (remaining === null) return SAMPLE_PHOTO_COUNT;
  return Math.max(0, Math.min(SAMPLE_PHOTO_COUNT, remaining));
}

// זוגות צבעים לגרדיאנט - גוונים רכים שמתאימים לפלטת האפליקציה
const GRADIENTS: [string, string][] = [
  ['#c98f89', '#2b3552'],
  ['#e3b3ac', '#6d5a8c'],
  ['#7fae86', '#1f3a4a'],
  ['#8fa8c9', '#3d2b4f'],
  ['#d9a066', '#5a2e3a'],
  ['#9bc6a2', '#c98f89'],
  ['#b58bb8', '#20304d'],
  ['#efd6b0', '#7a4f5e'],
];

export function sampleGradient(index: number): [string, string] {
  const i = ((Math.trunc(index) % GRADIENTS.length) + GRADIENTS.length) % GRADIENTS.length;
  return GRADIENTS[i];
}

// ספרות בתצוגת 7 מקטעים (מלבנים בלבד) - בכוונה בלי <text>: ב-runtime של
// Vercel אין פונטים אמינים לרינדור טקסט ב-SVG (ראו ההערה ב-lib/watermark.ts),
// ומלבנים תמיד מצטיירים נכון.
//   a
// f   b
//   g
// e   c
//   d
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// מלבנים של ספרה אחת בתוך תיבה (x,y) ברוחב w וגובה h
export function digitRects(digit: string, x: number, y: number, w: number, h: number): Rect[] {
  const segs = SEGMENTS[digit];
  if (!segs) return [];
  const t = Math.max(2, Math.round(w * 0.18)); // עובי מקטע
  const half = Math.round(h / 2);
  const map: Record<string, Rect> = {
    a: { x: x + t, y, w: w - 2 * t, h: t },
    b: { x: x + w - t, y: y + t, w: t, h: half - t - Math.round(t / 2) },
    c: { x: x + w - t, y: y + half + Math.round(t / 2), w: t, h: h - half - t - Math.round(t / 2) },
    d: { x: x + t, y: y + h - t, w: w - 2 * t, h: t },
    e: { x, y: y + half + Math.round(t / 2), w: t, h: h - half - t - Math.round(t / 2) },
    f: { x, y: y + t, w: t, h: half - t - Math.round(t / 2) },
    g: { x: x + t, y: y + half - Math.round(t / 2), w: w - 2 * t, h: t },
  };
  return segs.split('').map((s) => map[s]);
}

// מספר שלם (1..99 בפועל) ממורכז סביב (cx, cy)
export function numberRects(n: number, cx: number, cy: number, digitW: number, digitH: number): Rect[] {
  const digits = String(Math.max(0, Math.trunc(n))).split('');
  const gap = Math.round(digitW * 0.35);
  const totalW = digits.length * digitW + (digits.length - 1) * gap;
  const startX = Math.round(cx - totalW / 2);
  const y = Math.round(cy - digitH / 2);
  return digits.flatMap((d, i) => digitRects(d, startX + i * (digitW + gap), y, digitW, digitH));
}

// SVG מלא של תמונת דוגמה: גרדיאנט אלכסוני, עיגול "שמש" רך ומספר התמונה
export function sampleImageSvg(number: number, width = SAMPLE_IMAGE_WIDTH, height = SAMPLE_IMAGE_HEIGHT): string {
  const [from, to] = sampleGradient(number - 1);
  const digitH = Math.round(height * 0.32);
  const digitW = Math.round(digitH * 0.55);
  const rects = numberRects(number, width / 2, height / 2, digitW, digitH)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${Math.round(Math.min(r.w, r.h) / 2)}" />`)
    .join('');
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}" />
      <stop offset="1" stop-color="${to}" />
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)" />
  <circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.3)}" r="${Math.round(height * 0.38)}" fill="url(#sun)" />
  <g fill="#ffffff" fill-opacity="0.85">${rects}</g>
</svg>`;
}

export function sampleOriginalFilename(number: number): string {
  return `sample-${String(number).padStart(2, '0')}.jpg`;
}
