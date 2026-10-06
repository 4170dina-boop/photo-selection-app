'use client';

import { theme, inputStyle } from '@/lib/theme';
import { LANG_NAME, SUPPORTED_LANGS, normalizeLang, type Lang } from '@/lib/i18n/types';

// "שפת הגלריה והמיילים ללקוח/ה" בטופס יצירה/עריכה של גלריה (galleries.language,
// lib/i18n/galleryLanguage.ts). הלקוח/ה עדיין יכול/ה להחליף שפה בבורר שבגלריה;
// המיילים ללקוח/ה וההודעה המוכנה להעתקה נשלחים בשפה שנבחרה כאן.
export default function GalleryLanguageField({ value, onChange }: { value: Lang; onChange: (value: Lang) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <span>שפת הגלריה והמיילים ללקוח/ה</span>
      <select
        value={value}
        onChange={(e) => onChange(normalizeLang(e.target.value) ?? 'he')}
        style={{ ...inputStyle, width: '100%' }}
      >
        {SUPPORTED_LANGS.map((lang) => (
          <option key={lang} value={lang}>
            {LANG_NAME[lang]}
          </option>
        ))}
      </select>
      <span style={{ fontSize: 12, color: theme.textFaint }}>
        הגלריה נפתחת בשפה הזו (אפשר להחליף בתוכה), והמיילים ללקוח/ה נשלחים בה. המיילים אלייך נשארים בעברית.
      </span>
    </label>
  );
}
