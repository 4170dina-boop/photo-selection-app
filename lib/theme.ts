import type { CSSProperties } from 'react';

// פלטת "דינה שוורץ" - נייבי כהה + ורוד-פודרה אל אפרסק, serif אלגנטי לכותרות.
// מבוססת על עיצוב רפרנס שהתקבל מהמשתמשת (לא סגנון ה-gold/dark-gold המקורי).
export const theme = {
  bg: '#0f1626',
  panel: '#161c2d',
  panelInput: '#1b2236',
  border: 'rgba(232,224,210,0.11)',
  borderLight: 'rgba(232,224,210,0.22)',
  text: '#efe8db',
  textMuted: 'rgba(239,232,219,0.62)',
  textFaint: 'rgba(239,232,219,0.38)',
  gold: '#c98f89',
  goldBright: '#e3b3ac',
  goldText: '#20120f',
  green: '#7fae86',
  compare: '#8fa8c9',
  errorBg: 'rgba(181,96,108,0.14)',
  errorText: '#d98a96',
  successBg: 'rgba(127,174,134,0.12)',
  successText: '#9bc6a2',
  warningBg: 'rgba(201,143,137,0.14)',
  warningText: '#e3b3ac',
  fontSerif: 'var(--font-serif), serif',
  fontSans: 'var(--font-sans), sans-serif',
} as const;

export const inputStyle: CSSProperties = {
  padding: '0.65rem 0.85rem',
  background: theme.panelInput,
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  fontFamily: theme.fontSans,
  fontSize: 14,
};

export const goldButtonStyle: CSSProperties = {
  background: `linear-gradient(135deg, ${theme.goldBright}, ${theme.gold})`,
  color: theme.goldText,
  border: 'none',
  borderRadius: 4,
  padding: '0.7rem 1.3rem',
  fontWeight: 700,
  fontFamily: theme.fontSans,
  fontSize: 13.5,
  cursor: 'pointer',
};

export const outlineButtonStyle: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${theme.border}`,
  color: theme.textMuted,
  borderRadius: 4,
  padding: '0.6rem 1.1rem',
  fontFamily: theme.fontSans,
  fontSize: 13.5,
  fontWeight: 700,
  cursor: 'pointer',
};

export const headingStyle: CSSProperties = {
  fontFamily: theme.fontSerif,
  fontWeight: 500,
};
