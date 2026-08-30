'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

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
  filename: string;
  url: string;
}

export default function MagicButton({ galleryId }: MagicButtonProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [copiedCount, setCopiedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const isSupported = typeof window !== 'undefined' && !!window.showDirectoryPicker;

  async function fetchSelectedPhotos(): Promise<SelectedPhoto[]> {
    const res = await fetch(`/api/galleries/${galleryId}/selected-photos`);
    if (!res.ok) throw new Error('שליפת התמונות שנבחרו נכשלה');
    const data = await res.json();
    return data.photos ?? [];
  }

  // Chrome/Edge: מתאימה שמות קבצים מקומיים מתוך תיקיית מקור שהצלמת בוחרת,
  // ומעתיקה רק את הנבחרות לתיקיית יעד - בלי להוריד כלום מהשרת.
  async function handleMagicClick() {
    if (!window.showDirectoryPicker) {
      setStatus('error');
      setErrorMsg('הדפדפן שלך לא תומך בפיצ׳ר הזה. נסה Chrome או Edge.');
      return;
    }

    try {
      setStatus('running');

      const sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const destDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      const selectedPhotos = await fetchSelectedPhotos();
      const selectedFilenames = new Set(selectedPhotos.map((p) => p.filename));

      let count = 0;
      for await (const entry of sourceDirHandle.values()) {
        if (entry.kind === 'file' && selectedFilenames.has(entry.name)) {
          const file = await entry.getFile();
          const destFileHandle = await destDirHandle.getFileHandle(entry.name, { create: true });
          const writable = await destFileHandle.createWritable();
          await writable.write(file);
          await writable.close();
          count++;
        }
      }

      setCopiedCount(count);
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

      const selectedPhotos = await fetchSelectedPhotos();
      if (selectedPhotos.length === 0) {
        setStatus('error');
        setErrorMsg('אין עדיין תמונות שנבחרו בגלריה הזו.');
        return;
      }

      const zip = new JSZip();
      for (const photo of selectedPhotos) {
        const res = await fetch(photo.url);
        if (!res.ok) continue;
        zip.file(photo.filename, await res.blob());
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'תמונות-נבחרות.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);

      setCopiedCount(selectedPhotos.length);
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
        {status === 'done' && <p style={{ color: theme.successText, marginTop: '0.5rem' }}>הורדו {copiedCount} תמונות!</p>}
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
      {status === 'done' && <p style={{ color: theme.successText }}>הועברו {copiedCount} תמונות בהצלחה!</p>}
      {status === 'error' && <p style={{ color: theme.errorText }}>{errorMsg}</p>}
    </div>
  );
}
