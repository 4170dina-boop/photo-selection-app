// הקטנת תמונות לפני העלאה, מחוץ ל-main thread כשאפשר (Web Worker +
// OffscreenCanvas), עם גיבוי ל-canvas רגיל בדפדפן שלא תומך. מאגר קטן של
// workers (COMPRESS_POOL_SIZE) - כך שבזמן שתמונות אחרות עולות, הבאות בתור כבר
// מוקטנות ברקע, בלי שעשרות פענוחים של 24MP (~100MB זיכרון כל אחד) ירוצו יחד.
import { createSlotLimiter } from '@/lib/concurrency';
import {
  isResizableType,
  resizeImageToJpeg,
  shouldUseResized,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_EDGE,
  workersExhausted,
} from '@/lib/uploadResize';
import type { ResizeRequest, ResizeResponse } from './imageResize.worker';

// 2 מספיקים: הקטנה של תמונת מצלמה לוקחת בערך חצי שנייה, כלומר ~4 תמונות
// בשנייה - הרבה יותר מהר ממה שרוב חיבורי האינטרנט מעלים ~1.5MB לתמונה.
// יותר workers רק היו מוסיפים לחץ זיכרון ומתחרים במעבד עם הדף עצמו.
const COMPRESS_POOL_SIZE = 2;
const WORKER_TIMEOUT_MS = 30_000;

const runLimited = createSlotLimiter(COMPRESS_POOL_SIZE);
const workers: (Worker | null)[] = [];
// אחרי ש-worker אחד דיווח שאין תמיכה (או נכשל ביצירה), או אחרי
// MAX_WORKER_FAILURES קריסות - לא מנסים יותר.
let workersUnavailable = false;
let workerFailures = 0;
let nextRequestId = 1;

function getWorker(slot: number): Worker | null {
  if (workersUnavailable || typeof Worker === 'undefined') return null;
  if (!workers[slot]) {
    try {
      workers[slot] = new Worker(new URL('./imageResize.worker.ts', import.meta.url));
    } catch {
      workersUnavailable = true;
      return null;
    }
  }
  return workers[slot];
}

// null = ה-worker לא זמין (אין תמיכה/קרס) - הקורא נופל ל-main thread.
// { blob: null } = הפענוח עצמו נכשל - מעלים את המקור.
function resizeInWorker(worker: Worker, slot: number, file: Blob): Promise<{ blob: Blob | null } | null> {
  return new Promise((resolve) => {
    const id = nextRequestId++;
    // רשת ביטחון: worker שלא עונה (למשל נתקע על קובץ פגום) לא אמור לתקוע את
    // ההעלאה - אחרי WORKER_TIMEOUT_MS מעלים את המקור.
    // ה-worker התקוע מוחלף בחדש בתמונה הבאה.
    const timeout = setTimeout(() => {
      cleanup();
      worker.terminate();
      workers[slot] = null;
      resolve({ blob: null });
    }, WORKER_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = (e: MessageEvent<ResizeResponse>) => {
      if (e.data?.id !== id) return;
      cleanup();
      if ('unsupported' in e.data) {
        workersUnavailable = true;
        resolve(null);
      } else {
        resolve({ blob: e.data.blob });
      }
    };
    // קריסה של ה-worker - מחליפים רק אותו (חדש ייווצר בתמונה הבאה בסלוט הזה),
    // והתמונה הנוכחית מוקטנת על ה-main thread. רק אחרי MAX_WORKER_FAILURES
    // קריסות מוותרים על workers לגמרי.
    const onError = () => {
      cleanup();
      worker.terminate();
      if (workers[slot] === worker) workers[slot] = null;
      workerFailures++;
      if (workersExhausted(workerFailures)) workersUnavailable = true;
      resolve(null);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const request: ResizeRequest = { id, file, maxEdge: UPLOAD_MAX_EDGE, quality: UPLOAD_JPEG_QUALITY };
    worker.postMessage(request);
  });
}

function resizeOnMainThread(file: Blob): Promise<Blob | null> {
  return resizeImageToJpeg(file, UPLOAD_MAX_EDGE, UPLOAD_JPEG_QUALITY, (w, h) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  });
}

// מחזירה את הקובץ שבאמת עולה ל-R2: גרסה מוקטנת (UPLOAD_MAX_EDGE, JPEG), או
// המקור כמו שהוא אם: fullResolution (הצלמת ביקשה קבצים מלאים), סוג שלא
// מוקטנים בדפדפן, ההקטנה נכשלה, או שהיא לא חסכה כלום.
export async function prepareForUpload(file: File, fullResolution: boolean): Promise<File> {
  if (fullResolution || !isResizableType(file.type)) return file;

  return runLimited(async (slot) => {
    let blob: Blob | null = null;
    const worker = getWorker(slot);
    const fromWorker = worker ? await resizeInWorker(worker, slot, file) : null;
    if (fromWorker) blob = fromWorker.blob;
    else blob = await resizeOnMainThread(file);

    if (!blob || !shouldUseResized(file.size, blob.size)) return file;
    // שם הקובץ נשמר כמו שהוא - original_filename משמש להתאמה מול הקבצים
    // המקומיים של הצלמת בכפתור הקסם (components/MagicButton.tsx).
    return new File([blob], file.name, { type: 'image/jpeg', lastModified: file.lastModified });
  });
}
