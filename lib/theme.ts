import type { CSSProperties } from 'react';

// פלטת הצבעים הכהה-זהב מדף הגלריה של הלקוחה (app/gallery/[id]/page.tsx) -
// כאן כדי שדפי הדשבורד של הצלם ישתמשו באותה שפה עיצובית, במקום ה-CSS
// ברירת המחדל הלבן/שחור שהיה שם קודם.
export const theme = {
  bg: '#161210',
  panel: '#221c17',
  panelHover: '#2a221b',
  border: '#3a322a',
  borderLight: '#4a4136',
  text: '#e8ddc7',
  textMuted: '#a89b85',
  gold: '#d9b45c',
  goldText: '#1a1512',
  green: '#5cc98a',
  errorBg: '#4a1f1f',
  errorText: '#e88',
  successBg: '#1f3a24',
  successText: '#8fd9a0',
  warningBg: '#3a2a17',
  warningText: '#e0b567',
} as const;

export const inputStyle: CSSProperties = {
  padding: '0.6rem',
  background: theme.bg,
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
};

export const goldButtonStyle: CSSProperties = {
  background: theme.gold,
  color: theme.goldText,
  border: 'none',
  borderRadius: 8,
  padding: '0.6rem 1.2rem',
  fontWeight: 'bold',
  cursor: 'pointer',
};

export const outlineButtonStyle: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${theme.borderLight}`,
  color: theme.text,
  borderRadius: 8,
  padding: '0.5rem 1rem',
  cursor: 'pointer',
};
