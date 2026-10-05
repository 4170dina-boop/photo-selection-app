// הדבקת קוד גישה במסך הכניסה לגלריה (app/gallery/[id]/page.tsx) - פונקציות
// טהורות (בלי navigator), כדי שגם כפתור "הדבקה" וגם onPaste של התיבה ינרמלו
// בדיוק אותו דבר.
//
// לקוחות מעתיקות לפעמים את כל ההודעה מוואטסאפ ("...🔑 קוד גישה:\nXY12AB...")
// או קוד עם רווחים/מקפים/סימני כיווניות נסתרים - מוציאים מזה את הקוד עצמו.

// סימני כיווניות ותווים בלתי נראים שוואטסאפ/מיילים מוסיפים סביב טקסט
// (LRM/RLM, zero-width, embedding/isolate, BOM).
const INVISIBLE_CHARS = /[​-‏‪-‮⁦-⁩﻿­]/g;

// רווחים מכל סוג, מקפים (כולל en/em dash ומינוס יוניקוד), ועיצוב וואטסאפ
// (*מודגש*, _נטוי_, ~קו חוצה~, `קוד`) ומירכאות.
const SEPARATOR_CHARS = /[\s\-‐-―−*_~`"'״׳]/g;

// "קוד גישה:" / "קוד הגישה -" ואחריו (אולי בשורה הבאה) הקוד עצמו.
const LABELED_CODE = /קוד\s*(?:ה)?גישה\s*[:：\-–]?[\s*_~`"'״]*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/;

// ניקוי טקסט שהוקלד/הודבק לקוד: בלי תווים נסתרים, רווחים ומקפים, באותיות
// גדולות (הקודים נוצרים ב-hex באותיות גדולות, ראו generateAccessCode).
export function normalizePastedCode(raw: string): string {
  return raw.replace(INVISIBLE_CHARS, '').replace(SEPARATOR_CHARS, '').toUpperCase();
}

// מחלץ את הקוד מטקסט שהודבק: אם יש בו "קוד גישה: XXXX" (כל ההודעה הועתקה)
// לוקחים את מה שאחרי התווית, אחרת מנרמלים את כל הטקסט.
export function extractAccessCode(raw: string): string {
  const text = raw.replace(INVISIBLE_CHARS, '');
  const match = text.match(LABELED_CODE);
  if (match) return normalizePastedCode(match[1]);
  return normalizePastedCode(text);
}
