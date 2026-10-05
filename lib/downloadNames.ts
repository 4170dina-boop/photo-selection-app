// עזרים טהורים להורדות/ייצוא בצד הצלמת (components/MagicButton.tsx ו-final-photos).

// שמות ייחודיים בתוך ZIP: שתי תמונות עם אותו original_filename (למשל IMG_0001.jpg
// משתי מצלמות) היו דורסות זו את זו ב-zip.file. הראשונה נשארת כמו שהיא, הבאות
// מקבלות "name (2).jpg", "name (3).jpg"... ההשוואה לא תלויה ברישיות כי Windows/macOS
// מחלצים ZIP למערכת קבצים שלא מבחינה בין IMG.jpg ל-img.jpg.
export function makeUniqueFilenames(paths: string[]): string[] {
  const used = new Set<string>();
  return paths.map((path) => {
    let candidate = path;
    if (used.has(candidate.toLowerCase())) {
      const slash = path.lastIndexOf('/');
      const dir = path.slice(0, slash + 1);
      const base = path.slice(slash + 1);
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : '';
      let n = 2;
      do {
        candidate = `${dir}${stem} (${n})${ext}`;
        n++;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export type SortStatus = 'selected' | 'maybe' | 'gift' | 'extras';

// כמה "חשוב" כל סטטוס - כשכמה תמונות בגלריה חולקות שם קובץ, כפתור הקסם לא יכול
// לדעת לאיזו מהן הקובץ המקומי שייך (ההתאמה היא לפי שם בלבד), אז בוחרים את
// הסטטוס הגבוה ביותר: עדיף שתמונה תיכנס ל-Selected בטעות מאשר שתמונה שנבחרה
// תיבלע ב-Extras.
const STATUS_PRIORITY: Record<SortStatus, number> = { gift: 3, selected: 2, maybe: 1, extras: 0 };

// בונה מיפוי שם קובץ -> סטטוס מתוך רשימה שממופה לפי photo id (לא לפי שם, כדי
// שכפילויות לא ידרסו בשקט), ומחזיר גם אילו שמות היו כפולים - להצגת אזהרה.
export function resolveStatusByFilename(
  photos: Array<{ id: string; filename: string; status: SortStatus | null }>
): { statusByFilename: Map<string, SortStatus>; duplicateFilenames: string[] } {
  const statusById = new Map<string, SortStatus>(photos.map((p) => [p.id, p.status ?? 'extras']));
  const idsByFilename = new Map<string, string[]>();
  for (const p of photos) {
    const ids = idsByFilename.get(p.filename) ?? [];
    ids.push(p.id);
    idsByFilename.set(p.filename, ids);
  }

  const statusByFilename = new Map<string, SortStatus>();
  const duplicateFilenames: string[] = [];
  for (const [filename, ids] of idsByFilename) {
    if (ids.length > 1) duplicateFilenames.push(filename);
    let best: SortStatus = 'extras';
    for (const id of ids) {
      const s = statusById.get(id) ?? 'extras';
      if (STATUS_PRIORITY[s] > STATUS_PRIORITY[best]) best = s;
    }
    statusByFilename.set(filename, best);
  }
  return { statusByFilename, duplicateFilenames };
}

// הודעת סיכום להורדת ZIP: "הורדו X מתוך Y" + כמה נכשלו/חסרים, במקום "הורדו Y"
// גם כשחלק מהקבצים לא נכנסו בפועל.
export function downloadSummaryMessage(downloaded: number, failed: number, missing: number): string {
  const total = downloaded + failed + missing;
  if (failed === 0 && missing === 0) return `הורדו ${downloaded} תמונות!`;
  const parts = [`הורדו ${downloaded} מתוך ${total} תמונות`];
  if (failed > 0) parts.push(`${failed} נכשלו בהורדה`);
  if (missing > 0) parts.push(`${missing} כבר לא קיימות באחסון (המקור נמחק)`);
  return parts.join(' · ');
}

// מפתחות R2 של גלריה תמיד מתחילים ב-"<galleryId>/" (ראו presign-upload). file_path
// ב-delivered_photos נכתב מצד הלקוח (insert עם session client), אז לפני חתימה או
// מחיקה ב-R2 מוודאים שהמפתח באמת שייך לגלריה הזו - אחרת שורה עם file_path
// של גלריה אחרת הייתה מאפשרת לקרוא/למחוק קבצים שלא שלה.
export function isKeyInGallery(key: unknown, galleryId: string): key is string {
  return typeof key === 'string' && galleryId.length > 0 && key.startsWith(`${galleryId}/`) && !key.split('/').includes('..');
}
