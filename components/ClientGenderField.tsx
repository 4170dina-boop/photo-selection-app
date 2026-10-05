'use client';

import { theme } from '@/lib/theme';
import type { Gender } from '@/lib/gender';

// "פנייה ללקוח/ה" בטופס יצירה/עריכה של גלריה - קובע את לשון הפנייה בגלריה
// ובמיילים ללקוח/ה הראשי/ת (galleries.client_gender, lib/gender.ts).
const OPTIONS: { value: Gender; label: string }[] = [
  { value: 'f', label: '👩 בלשון נקבה' },
  { value: 'm', label: '👨 בלשון זכר' },
];

export default function ClientGenderField({ value, onChange }: { value: Gender; onChange: (value: Gender) => void }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <legend style={{ padding: 0, marginBottom: '0.35rem' }}>פנייה ללקוח/ה</legend>
      <div role="radiogroup" style={{ display: 'flex', gap: '0.5rem' }}>
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                fontFamily: theme.fontSans,
                border: `1px solid ${active ? theme.gold : theme.border}`,
                background: active ? `${theme.gold}22` : 'transparent',
                color: active ? theme.gold : theme.textMuted,
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 12, color: theme.textFaint }}>
        קובע איך הגלריה והמיילים פונים ללקוח/ה (למשל &quot;בחרי&quot; / &quot;בחר&quot;)
      </span>
    </fieldset>
  );
}
