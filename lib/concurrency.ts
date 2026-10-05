// הרצת fn על כל פריט במקביל, אבל לכל היותר `limit` בבת אחת - למשל שאילתה
// לכל גלריה (app/api/galleries/cover-photos) בלי להציף את ה-DB.
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const workers = Array.from({ length: items.length === 0 ? 0 : workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}
