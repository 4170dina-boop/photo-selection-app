// פונקציית DB (RPC) שעוד לא קיימת - מיגרציה שלא רצה. PostgREST מחזיר
// PGRST202 ("Could not find the function ... in the schema cache"), ו-Postgres
// עצמו 42883 (undefined_function). רק במקרה הזה מותר ליפול לנתיב הישן -
// כל שגיאה אחרת היא תקלה אמיתית ולא "פונקציה חסרה".
export function isMissingFunctionError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const message = error.message ?? '';
  return /could not find the function/i.test(message) || /function .* does not exist/i.test(message);
}
