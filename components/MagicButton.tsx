'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// הרחבת טיפוסים - File System Access API עוד לא בטיפוסי TS הרשמיים באופן מלא
declare global {
  interface Window {
    showDirectoryPicker?: (options?: any) => Promise<any>;
  }
}

interface MagicButtonProps {
  galleryId: string;
}

export default function MagicButton({ galleryId }: MagicButtonProps) {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [copiedCount, setCopiedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const isSupported = typeof window !== 'undefined' && !!window.showDirectoryPicker;

  async function handleMagicClick() {
    if (!window.showDirectoryPicker) {
      setStatus('error');
      setErrorMsg('הדפדפן שלך לא תומך בפיצ׳ר הזה. נסה Chrome או Edge.');
      return;
    }

    try {
      setStatus('running');

      // שלב 1: המשתמש בוחר תיקיית מקור (איפה כל התמונות המקוריות נמצאות)
      const sourceDirHandle = await window.showDirectoryPicker({ mode: 'read' });

      // שלב 2: המשתמש בוחר/יוצר תיקיית יעד (לאן להעתיק את הנבחרות)
      const destDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      // שלב 3: שליפת רשימת הקבצים הנבחרים מה-DB
      const { data: selections, error } = await supabase
        .from('selections')
        .select('photo_id, photos(original_filename)')
        .eq('gallery_id', galleryId);

      if (error) throw error;

      const selectedFilenames = new Set(
        selections?.map((s: any) => s.photos?.original_filename).filter(Boolean)
      );

      // שלב 4: מעבר על תיקיית המקור והעתקת רק הקבצים הנבחרים
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

      // שלב 5: רישום ה-job כהושלם (ל-sync_jobs)
      await supabase.from('sync_jobs').insert({
        gallery_id: galleryId,
        status: 'completed',
        photos_copied: count,
        completed_at: new Date().toISOString(),
      });
    } catch (err: any) {
      // המשתמש יכול לבטל את בחירת התיקייה - זו לא באמת שגיאה
      if (err.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      console.error(err);
      setStatus('error');
      setErrorMsg('משהו השתבש בזמן ההעתקה. נסה שוב.');
    }
  }

  if (!isSupported) {
    return (
      <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: 8 }}>
        <p>כפתור הקסם זמין רק ב-Chrome או Edge בשלב זה.</p>
        <p>אפשר להוריד את התמונות הנבחרות בנפרד כ-ZIP (fallback).</p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={handleMagicClick} disabled={status === 'running'}>
        {status === 'running' ? 'ממיין תמונות...' : '✨ כפתור הקסם'}
      </button>
      {status === 'done' && <p>הועתקו {copiedCount} תמונות לתיקיית היעד!</p>}
      {status === 'error' && <p style={{ color: 'red' }}>{errorMsg}</p>}
    </div>
  );
}
