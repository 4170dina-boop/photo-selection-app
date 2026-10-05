// Supabase (PostgREST) מחזיר לכל היותר 1000 שורות לשאילתה כברירת מחדל - בלי
// pagination, ייצוא של צלמת עם יותר מ-1000 גלריות היה נחתך בשקט. קוראים עמוד
// אחרי עמוד עם .range(from, to) עד שמגיע עמוד קצר מגודל העמוד.
// השאילתה שמועברת חייבת order יציב (למשל created_at + id), אחרת עמודים יכולים
// לחפוף או לדלג על שורות.
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}
