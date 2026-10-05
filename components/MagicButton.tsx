'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { makeUniqueFilenames, resolveStatusByFilename, downloadSummaryMessage, type SortStatus } from '@/lib/downloadNames';

// הרחבת טיפוסים - File System Access API עוד לא בטיפוסי TS הרשמיים באופן מלא
declare global {
  interface Window {
    showDirectoryPicker?: (options?: any) => Promise<any>;
  }
}

interface MagicButtonProps {
  galleryId: string;
}

interface SelectedPhoto {
  id: string;
  filename: string;
  url: string;
  // תמונת מתנה (lib/gifts.ts) - כלולה אוטומטית, נכנסת לתיקיית Gift ב-ZIP
  isGift?: boolean;
}

interface PhotoWithStatus {
  id: string;
  filename: string;
  status: 'selected' | 'maybe' | 'gift' | null;
}

// סטטוס -> שם תיקיית היעד. null (לא סומן בכלל) הולך ל-Extras. gift = תמונת
// מתנה שהצלמת סימנה - נערכת תמיד, אז מקבלת תיקייה משלה ולא נבלעת ב-Extras.
const FOLDER_BY_STATUS: Record<'selected' | 'maybe' | 'gift' | 'extras', string> = {
  selected: 'Selected',
  maybe: 'Maybe',
  gift: 'Gift',
  extras: 'Extras',
};

export default function MagicButton({ galleryId }: MagicButtonProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [copiedCount, setCopiedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  // הודעת סיכום ל-ZIP ("הורדו X מתוך Y...") ואזהרה על שמות כפולים בכפתור הקסם
  const [doneMsg, setDoneMsg] = useState('');
  const [lastAction, setLastAction] = useState<'magic' | 'zip'>('magic');

  const isSupported = typeof window !== 'undefined' && !!window.showDirectoryPicker;

  async function fetchSelectedPhotos(): Promise<{ photos: SelectedPhoto[]; missingCount: number }> {
    const res = await fetch(`/api/galleries/${galleryId}/selected-photos`);
    if (!res.ok) throw new Error('שליפת התמונות שנבחרו נכשלה');
    const data = await res.json();
    return { photos: data.photos ?? [], missingCount: data.missingCount ?? 0 };
  }

  async function fetchPhotosByStatus(): Promise<PhotoWithStatus[]> {
    const res = await fetch(`/api/galleries/${galleryId}/photos-by-status`);
    if (!res.ok) throw new Error('שליפת סטטוס התמונות נכשלה');
    const data = await res.json();
    return data.photos ?? [];
  }

  // Chrome/Edge: מתאימה שמות קבצים מקומיים מתוך תיקיית מקור שהצלמת בוחרת,
  // ומעתיקה כל קובץ תואם לתת-תיקייה לפי הסטטוס שלו (Selected/Maybe/Extras) -
  // בלי להוריד כלום מהשרת.
  async function handleMagicClick() {
    if (!window.showDirectoryPicker) {
      setStatus('error');
      setErrorMsg('הדפדפן שלך לא תומך בפיצ׳ר הזה. נסה Chrome או Edge.');
      return;
    }

    try {
      setStatus('running');
      setLastAction('magic');
      setDoneMsg('');

      const sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const destDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      const photos = await fetchPhotosByStatus();
      // סטטוס ממופה לפי photo id; כשכמה תמונות חולקות שם קובץ נבחר הסטטוס
      // ה"חזק" ביותר (ההתאמה לקובץ המקומי היא לפי שם בלבד) ומציגים אזהרה.
      const { statusByFilename, duplicateFilenames } = resolveStatusByFilename(
        photos.map((p) => ({ id: p.id, filename: p.filename, status: p.status }))
      );

      // נוצרות רק לפי צורך (create: true) כדי לא להשאיר תיקיות ריקות אם קטגוריה כלשהי לא רלוונטית
      const subDirHandles = new Map<string, any>();
      async function getSubDirHandle(folderName: string) {
        let handle = subDirHandles.get(folderName);
        if (!handle) {
          handle = await destDirHandle.getDirectoryHandle(folderName, { create: true });
          subDirHandles.set(folderName, handle);
        }
        return handle;
      }

      let count = 0;
      for await (const entry of sourceDirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const matchedStatus = statusByFilename.get(entry.name);
        if (!matchedStatus) continue;

        const folderName = FOLDER_BY_STATUS[matchedStatus as SortStatus];
        const subDirHandle = await getSubDirHandle(folderName);

        const file = await entry.getFile();
        const destFileHandle = await subDirHandle.getFileHandle(entry.name, { create: true });
        const writable = await destFileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        count++;
      }

      setCopiedCount(count);
      setDoneMsg(
        duplicateFilenames.length > 0
          ? `שימי לב: ${duplicateFilenames.length} שמות קבצים מופיעים יותר מפעם אחת בגלריה (למשל ${duplicateFilenames[0]}) - כדאי לבדוק אותם ידנית.`
          : ''
      );
      setStatus('done');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      console.error(err);
      setStatus('error');
      setErrorMsg('משהו השתבש בזמן ההעתקה. נסה שוב.');
    }
  }

  // Safari/Firefox (או כל דפדפן בלי File System Access API): מורידה את הקבצים
  // עצמם מה-Storage (דרך signed URLs) ומארזת ל-ZIP אחד בצד הלקוח.
  async function handleZipDownload() {
    try {
      setStatus('running');
      setLastAction('zip');
      setDoneMsg('');

      const { photos: selectedPhotos, missingCount } = await fetchSelectedPhotos();
      if (selectedPhotos.length === 0) {
        setStatus('error');
        setErrorMsg(
          missingCount > 0
            ? `${missingCount} התמונות שנבחרו כבר לא קיימות באחסון (המקור נמחק) - אין מה להוריד.`
            : 'אין עדיין תמונות שנבחרו בגלריה הזו.'
        );
        return;
      }

      // שמות ייחודיים בתוך ה-ZIP - שני קבצים עם אותו original_filename היו דורסים זה את זה
      const zipPaths = makeUniqueFilenames(
        selectedPhotos.map((p) => (p.isGift ? `${FOLDER_BY_STATUS.gift}/${p.filename}` : p.filename))
      );

      // URLs טריים לפי photo id, אם החתימות פגו באמצע ההורדה (403 מ-R2).
      // מוגבל לכמה רענונים כדי לא להיכנס ללולאה אם משהו אחר שבור.
      const urlById = new Map(selectedPhotos.map((p) => [p.id, p.url]));
      let refreshesLeft = 3;
      async function refreshUrls() {
        refreshesLeft--;
        const fresh = await fetchSelectedPhotos();
        for (const p of fresh.photos) urlById.set(p.id, p.url);
      }

      async function tryFetch(url: string | undefined): Promise<Response | null> {
        if (!url) return null;
        try {
          return await fetch(url);
        } catch {
          return null; // שגיאת רשת - נספר ככישלון
        }
      }

      const zip = new JSZip();
      let downloaded = 0;
      let failed = 0;
      for (let i = 0; i < selectedPhotos.length; i++) {
        const photo = selectedPhotos[i];
        let res = await tryFetch(urlById.get(photo.id));
        if (res && res.status === 403 && refreshesLeft > 0) {
          try {
            await refreshUrls();
            res = await tryFetch(urlById.get(photo.id));
          } catch {
            // הרענון עצמו נכשל - נשארים עם התשובה המקורית (403) ונספור ככישלון
          }
        }
        if (!res || !res.ok) {
          failed++;
          continue;
        }
        zip.file(zipPaths[i], await res.blob());
        downloaded++;
      }

      if (downloaded === 0) {
        setStatus('error');
        setErrorMsg(`אף תמונה לא הורדה (${downloadSummaryMessage(0, failed, missingCount)}). נסי שוב.`);
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'תמונות-נבחרות.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // ביטול מיידי אחרי click() יכול לבטל את ההורדה לפני שהדפדפן התחיל לקרוא
      // את ה-blob (נצפה ב-Safari/Firefox) - דוחים כדי לתת להורדה להתחיל.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

      setCopiedCount(downloaded);
      setDoneMsg(downloadSummaryMessage(downloaded, failed, missingCount));
      setStatus('done');
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg('משהו השתבש בהכנת ה-ZIP. נסה שוב.');
    }
  }

  if (!isSupported) {
    return (
      <div>
        <button onClick={handleZipDownload} disabled={status === 'running'} style={{ ...goldButtonStyle, opacity: status === 'running' ? 0.6 : 1 }}>
          {status === 'running' ? 'מכינה ZIP...' : '📦 הורדת התמונות הנבחרות כ-ZIP'}
        </button>
        <p style={{ fontSize: 12, color: theme.textFaint, marginTop: '0.5rem' }}>
          "כפתור הקסם" (מיון אוטומטי מול תיקייה מקומית) זמין רק ב-Chrome או Edge.
        </p>
        {status === 'done' && <p style={{ color: theme.successText, marginTop: '0.5rem' }}>{doneMsg || `הורדו ${copiedCount} תמונות!`}</p>}
        {status === 'error' && <p style={{ color: theme.errorText, marginTop: '0.5rem' }}>{errorMsg}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button onClick={handleMagicClick} disabled={status === 'running'} style={{ ...goldButtonStyle, opacity: status === 'running' ? 0.6 : 1 }}>
          {status === 'running' ? 'ממיינת תמונות...' : '✨ כפתור הקסם'}
        </button>
        <button onClick={handleZipDownload} disabled={status === 'running'} style={{ ...outlineButtonStyle, opacity: status === 'running' ? 0.6 : 1 }}>
          📦 הורדה כ-ZIP
        </button>
      </div>
      {status === 'done' && lastAction === 'zip' && <p style={{ color: theme.successText }}>{doneMsg}</p>}
      {status === 'done' && lastAction === 'magic' && (
        <>
          <p style={{ color: theme.successText }}>
            הועברו {copiedCount} תמונות בהצלחה, ממוינות לתיקיות Selected / Maybe / Gift / Extras!
          </p>
          {doneMsg && <p style={{ color: theme.textFaint, fontSize: 13 }}>{doneMsg}</p>}
        </>
      )}
      {status === 'error' && <p style={{ color: theme.errorText }}>{errorMsg}</p>}
    </div>
  );
}
