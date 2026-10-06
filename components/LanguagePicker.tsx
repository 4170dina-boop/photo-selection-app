'use client';

import { theme } from '@/lib/theme';
import { LANG_NAME, LANG_SHORT_LABEL, SUPPORTED_LANGS, t, type Lang } from '@/lib/i18n';

// בורר שפה קומפקטי לגלריית הלקוח/ה: "🌐 עב | EN | ייִד | ES | FR".
// השמירה (localStorage) והחלת הכיוון - אצל הקורא (app/gallery/[id]/page.tsx).
export default function LanguagePicker({ lang, onChange, accent }: { lang: Lang; onChange: (lang: Lang) => void; accent?: string }) {
  const active = accent ?? theme.gold;
  return (
    <div
      role="group"
      aria-label={t(lang, 'common.language')}
      // כיוון קבוע - הסדר של הבורר לא מתהפך כשמחליפים שפה
      dir="ltr"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: theme.textFaint, flexWrap: 'wrap' }}
    >
      <span aria-hidden="true" style={{ marginInlineEnd: 2 }}>🌐</span>
      {SUPPORTED_LANGS.map((code, i) => {
        const selected = code === lang;
        return (
          <span key={code} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && <span aria-hidden="true" style={{ opacity: 0.5, padding: '0 1px' }}>|</span>}
            <button
              type="button"
              lang={code}
              aria-pressed={selected}
              aria-label={LANG_NAME[code]}
              title={LANG_NAME[code]}
              onClick={() => onChange(code)}
              style={{
                minWidth: 32, minHeight: 32, padding: '0 5px', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: selected ? `${active}22` : 'transparent',
                color: selected ? active : theme.textMuted,
                fontWeight: selected ? 700 : 400, fontSize: 12, fontFamily: theme.fontSans,
              }}
            >
              {LANG_SHORT_LABEL[code]}
            </button>
          </span>
        );
      })}
    </div>
  );
}
