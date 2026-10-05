// מאגד קריאות בודדות שמגיעות בהפרש זמן קצר לבקשה אחת לשרת - למשל בקשת URL
// חתום או רישום תמונה בהעלאה (app/dashboard/UploadProvider.tsx). כל קורא מקבל
// את התוצאה שלו בלבד, כאילו שלח בקשה משלו. נשלח כשמגיעים ל-maxSize פריטים, או
// delayMs אחרי הפריט הראשון שממתין - מה שקודם.
//
// run חייב להחזיר מערך באותו אורך ובאותו סדר כמו הקלט. אם run נכשל כולו (שגיאת
// רשת וכו') - כל הקוראים בקבוצה מקבלים את אותה שגיאה.
export function createMicroBatcher<I, O>(options: {
  maxSize: number;
  delayMs: number;
  run: (items: I[]) => Promise<O[]>;
}): (item: I) => Promise<O> {
  const maxSize = Math.max(1, Math.floor(options.maxSize) || 1);
  let pending: { item: I; resolve: (o: O) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;

    options
      .run(batch.map((b) => b.item))
      .then((results) => {
        if (!Array.isArray(results) || results.length !== batch.length) {
          throw new Error('תשובה לא תקינה מהשרת');
        }
        batch.forEach((b, i) => b.resolve(results[i]));
      })
      .catch((err) => batch.forEach((b) => b.reject(err)));
  }

  return (item: I) =>
    new Promise<O>((resolve, reject) => {
      pending.push({ item, resolve, reject });
      if (pending.length >= maxSize) flush();
      else if (!timer) timer = setTimeout(flush, options.delayMs);
    });
}
