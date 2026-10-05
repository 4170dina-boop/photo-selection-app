// Web Worker להקטנת תמונות לפני העלאה (ראו uploadCompressor.ts) - הפענוח של
// JPEG של 24MP והקידוד מחדש לוקחים מאות מילישניות לכל תמונה, ועל ה-main
// thread זה הקפיא את הדף (וגם עיכב את שליחת הבקשות של ההעלאות האחרות).
import { resizeImageToJpeg } from '@/lib/uploadResize';

export interface ResizeRequest {
  id: number;
  file: Blob;
  maxEdge: number;
  quality: number;
}

export type ResizeResponse = { id: number; blob: Blob | null } | { id: number; unsupported: true };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ResizeRequest>) => void) | null;
  postMessage: (msg: ResizeResponse) => void;
};

let offscreen2d: boolean | null = null;
function supportsOffscreen2d(): boolean {
  if (offscreen2d === null) {
    try {
      offscreen2d =
        typeof OffscreenCanvas !== 'undefined' &&
        typeof createImageBitmap !== 'undefined' &&
        !!new OffscreenCanvas(1, 1).getContext('2d');
    } catch {
      offscreen2d = false;
    }
  }
  return offscreen2d;
}

scope.onmessage = async (e) => {
  const { id, file, maxEdge, quality } = e.data;
  // דפדפן עם Worker אבל בלי OffscreenCanvas דו-ממדי (Safari ישן) - הצד השני
  // נופל לעיבוד על ה-main thread.
  if (!supportsOffscreen2d()) {
    scope.postMessage({ id, unsupported: true });
    return;
  }

  const blob = await resizeImageToJpeg(file, maxEdge, quality, (w, h) => new OffscreenCanvas(w, h));
  scope.postMessage({ id, blob });
};
