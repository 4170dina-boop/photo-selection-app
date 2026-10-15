import { galleryCssVars, type GalleryColors } from './galleryTheme';

// מחיל את צבעי העיצוב (lib/galleryTheme.ts) על כל הדף כ-CSS variables, ומחזיר
// פונקציית ניקוי שמחזירה את הפלטה הרגילה. משמש גם את גלריית הלקוחה וגם את
// אזור הצלמת (app/dashboard/layout.tsx).
export function applyThemeVars(colors: GalleryColors): () => void {
  const root = document.documentElement;
  const vars = galleryCssVars(colors);
  Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
  const previousBg = document.body.style.background;
  const previousColor = document.body.style.color;
  document.body.style.background = colors.bg;
  document.body.style.color = colors.text;
  return () => {
    Object.keys(vars).forEach((name) => root.style.removeProperty(name));
    document.body.style.background = previousBg;
    document.body.style.color = previousColor;
  };
}

// הגדרות -> עיצוב: אחרי שמירה, אזור הצלמת מתעדכן מיד בלי רענון
export const THEME_CHANGED_EVENT = 'photographer-theme-changed';
