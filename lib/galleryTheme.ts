// עיצוב צבעי גלריית הלקוחה לכל צלמת (photographers.custom_theme): רקע, כרטיסים,
// טקסט וצבע הדגשה/כפתורים. lib/theme.ts מגדיר את צבעי הבסיס כ-CSS variables עם
// ברירת מחדל, ו-galleryCssVars מחשב מכאן את כל הגוונים הנגזרים (טקסט משני,
// מסגרות, שדות קלט) כדי שהצלמת תבחר רק 4 צבעים והשאר יתאים אוטומטית.

export interface GalleryColors {
  bg: string;
  panel: string;
  text: string;
  accent: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isGalleryColors(value: unknown): value is GalleryColors {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (['bg', 'panel', 'text', 'accent'] as const).every((k) => typeof t[k] === 'string' && HEX_RE.test(t[k] as string));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// בהירות יחסית (WCAG) - 0 שחור, 1 לבן
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// טקסט על כפתור בצבע ההדגשה - שחור או לבן, מה שקריא יותר
export function textOn(hex: string): string {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#1a1a1a' : '#ffffff';
}

export function galleryCssVars(t: GalleryColors): Record<string, string> {
  return {
    '--t-bg': t.bg,
    '--t-panel': t.panel,
    '--t-panel-input': mix(t.panel, t.text, 0.06),
    '--t-border': rgba(t.text, 0.14),
    '--t-border-light': rgba(t.text, 0.26),
    '--t-text': t.text,
    '--t-text-muted': rgba(t.text, 0.66),
    '--t-text-faint': rgba(t.text, 0.42),
    '--t-gold': mix(t.accent, '#000000', 0.12),
    '--t-gold-bright': t.accent,
    '--t-gold-text': textOn(t.accent),
    '--t-gold-tint': rgba(t.accent, 0.13),
    '--t-gold-ring': rgba(t.accent, 0.27),
  };
}

// בעיות קריאות שכדאי להזהיר עליהן לפני שמירה
export function themeWarnings(t: GalleryColors): string[] {
  const warnings: string[] = [];
  if (contrastRatio(t.text, t.bg) < 4.5) warnings.push('הטקסט כמעט לא נקרא על הרקע - כדאי טקסט כהה יותר על רקע בהיר (או להפך)');
  if (contrastRatio(t.text, t.panel) < 4.5) warnings.push('הטקסט כמעט לא נקרא על הכרטיסים');
  if (contrastRatio(t.panel, t.bg) < 1.08) warnings.push('הכרטיסים כמעט באותו צבע של הרקע - קשה להבחין ביניהם');
  if (contrastRatio(t.accent, t.bg) < 1.6) warnings.push('צבע הכפתורים קרוב מדי לרקע');
  return warnings;
}

export const THEME_PRESETS: { name: string; colors: GalleryColors }[] = [
  { name: 'נייבי וורוד (המקורי)', colors: { bg: '#0f1626', panel: '#161c2d', text: '#efe8db', accent: '#e3b3ac' } },
  { name: 'לבן נקי', colors: { bg: '#ffffff', panel: '#f4f4f2', text: '#222222', accent: '#b88a6a' } },
  { name: 'שמנת וזהב', colors: { bg: '#faf6ef', panel: '#f1e9dc', text: '#3a2f25', accent: '#b8914a' } },
  { name: 'ורוד פודרה', colors: { bg: '#fbf1ef', panel: '#f5e1dd', text: '#4a2f2c', accent: '#c47a72' } },
  { name: 'מרווה', colors: { bg: '#f2f5ef', panel: '#e3ebdd', text: '#2d3a2b', accent: '#6f8f68' } },
  { name: 'תכלת רך', colors: { bg: '#f1f5fa', panel: '#e1eaf4', text: '#1f2d3d', accent: '#5b84b1' } },
  { name: 'שחור אלגנטי', colors: { bg: '#111111', panel: '#1c1c1c', text: '#f2f2f2', accent: '#d4af7a' } },
  { name: 'בורדו', colors: { bg: '#1e0f13', panel: '#2a161b', text: '#f3e6e8', accent: '#d88a9a' } },
  { name: 'ירוק יער', colors: { bg: '#0f1a15', panel: '#17251e', text: '#e7efe9', accent: '#9cc3a5' } },
];

// ---- צבעים מהלוגו ----

// pixels = RGBA רציף (ImageData.data). מקבץ לפי גוונים מעוגלים, מתעלם
// משקיפות, ומחזיר עד max צבעים שכיחים ושונים זה מזה.
export function extractLogoColors(pixels: ArrayLike<number>, max = 6): string[] {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const sorted = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .map((bk) => rgbToHex([bk.r / bk.count, bk.g / bk.count, bk.b / bk.count]));
  const picked: string[] = [];
  for (const color of sorted) {
    if (picked.every((p) => colorDistance(p, color) > 60)) picked.push(color);
    if (picked.length >= max) break;
  }
  return picked;
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// שתי הצעות (בהירה וכהה) מצבעי הלוגו: הצבע הכי "חי" הופך לכפתורים, והרקע
// והכרטיסים הם גוונים רכים שלו - כך שהגלריה מרגישה כמו המותג בלי להיות צעקנית.
export function themesFromLogo(colors: string[]): { name: string; colors: GalleryColors }[] {
  if (colors.length === 0) return [];
  const accent = [...colors].sort((a, b) => saturation(b) - saturation(a))[0];
  const darkest = [...colors].sort((a, b) => luminance(a) - luminance(b))[0];
  const lightBg = mix(accent, '#ffffff', 0.92);
  const darkBg = mix(luminance(darkest) < 0.08 ? darkest : accent, '#0b0b0f', 0.82);
  return [
    {
      name: 'בהיר לפי הלוגו',
      colors: { bg: lightBg, panel: mix(accent, '#ffffff', 0.82), text: mix(darkest, '#1a1a1a', luminance(darkest) < 0.15 ? 0 : 0.7), accent },
    },
    {
      name: 'כהה לפי הלוגו',
      colors: { bg: darkBg, panel: mix(darkBg, '#ffffff', 0.06), text: mix(accent, '#ffffff', 0.88), accent: luminance(accent) < 0.12 ? mix(accent, '#ffffff', 0.45) : accent },
    },
  ];
}
