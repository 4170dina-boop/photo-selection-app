import type { CSSProperties } from 'react';

// פלטת "דינה שוורץ" - נייבי כהה + ורוד-פודרה אל אפרסק, serif אלגנטי לכותרות.
// מבוססת על עיצוב רפרנס שהתקבל מהמשתמשת (לא סגנון ה-gold/dark-gold המקורי).
//
// צבעי הבסיס הם CSS variables עם ברירת מחדל: בדשבורד לא מוגדר שום משתנה ונשארת
// הפלטה הזו; בגלריית הלקוחה המשתנים נקבעים לפי העיצוב שהצלמת בחרה
// (photographers.custom_theme, ראו lib/galleryTheme.ts). לכן אסור לחבר לערכים
// האלה סיומת שקיפות (`${theme.bg}44`) - רק להשתמש בהם כמו שהם ב-CSS.
export const theme = {
  bg: 'var(--t-bg, #0f1626)',
  panel: 'var(--t-panel, #161c2d)',
  panelInput: 'var(--t-panel-input, #1b2236)',
  border: 'var(--t-border, rgba(232,224,210,0.11))',
  borderLight: 'var(--t-border-light, rgba(232,224,210,0.22))',
  text: 'var(--t-text, #efe8db)',
  textMuted: 'var(--t-text-muted, rgba(239,232,219,0.62))',
  textFaint: 'var(--t-text-faint, rgba(239,232,219,0.38))',
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
  // 16px ולא פחות - מתחת לזה iOS Safari מזום אוטומטית פנימה בפוקוס על השדה,
  // מה שממש מפריע בהזנת קוד גישה או הערה מהנייד
  fontSize: 16,
};

export const focusVisibleRing = {
  outline: `2px solid ${theme.goldBright}`,
  outlineOffset: 2,
  boxShadow: `0 0 0 3px ${theme.gold}44`,
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
  // border-box: בלי זה minHeight נספר בלי ה-padding, וקישורים (inline-block)
  // בתפריט נמתחו לגובה ~65px עם הטקסט צמוד למעלה.
  minHeight: 44,
  boxSizing: 'border-box',
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
  // border-box: בלי זה minHeight נספר בלי ה-padding, וקישורים (inline-block)
  // בתפריט נמתחו לגובה ~65px עם הטקסט צמוד למעלה.
  minHeight: 44,
  boxSizing: 'border-box',
};

export const headingStyle: CSSProperties = {
  fontFamily: theme.fontSerif,
  fontWeight: 500,
};
