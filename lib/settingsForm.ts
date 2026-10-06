// שדות מספריים בטופס ההגדרות (app/dashboard/settings/page.tsx): שדה ריק לא
// נשלח כ-0 - Number('') הוא 0, וכך מחיקת הערך בטעות הייתה שומרת 0 תמונות
// בחבילה / 0 ימי תזכורת בלי שהצלמת שמה לב. ריק או לא-מספר = null.
export function numberOrNull(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// שמות השדות החובה שנשארו ריקים (או לא מספר) - להודעת אימות לפני השליחה.
export function missingNumberFields(fields: { label: string; value: string }[]): string[] {
  return fields.filter((f) => numberOrNull(f.value) === null).map((f) => f.label);
}
