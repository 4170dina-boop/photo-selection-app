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

// מגביל כמה הרצות של משימה רצות בו-זמנית, כשהמשימות מגיעות בזמנים שונים (לא
// רשימה מוכנה מראש כמו ב-mapWithConcurrency) - למשל הקטנת תמונות לפני העלאה
// (app/dashboard/uploadCompressor.ts). כל הרצה מקבלת מספר "משבצת" קבוע
// (0..limit-1) כדי שאפשר יהיה להצמיד לה משאב (Worker) בלי שתי הרצות עליו יחד.
// סדר ההמתנה הוא FIFO.
export function createSlotLimiter(limit: number) {
  const size = Math.max(1, Math.floor(limit) || 1);
  const free: number[] = Array.from({ length: size }, (_, i) => i);
  const waiting: ((slot: number) => void)[] = [];

  return async function run<R>(fn: (slot: number) => Promise<R>): Promise<R> {
    const slot = free.length > 0 ? free.shift()! : await new Promise<number>((resolve) => waiting.push(resolve));
    try {
      return await fn(slot);
    } finally {
      const next = waiting.shift();
      if (next) next(slot);
      else free.push(slot);
    }
  };
}
