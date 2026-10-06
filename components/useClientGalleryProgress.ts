'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientProgressState } from '@/lib/clientProgress';
import type { PaymentLinks } from '@/lib/paymentLinks';

// טעינת app/api/gallery/[id]/progress לקומפוננטות "מה הבא?" ו"תשלום על
// התוספת". מתרענן כשהעמוד חוזר לפוקוס (focus + visibilitychange), כדי
// שלקוחה שחוזרת לטאב אחרי יום-יומיים תראה מיד "הצלמת עורכת"/"מוכנות".

export interface ClientGalleryProgress {
  status: string | null;
  editingStarted: boolean;
  delivered: boolean;
  deliveredAt: string | null;
  deliveredCount: number;
  progress: ClientProgressState | null;
  // null = לא בעלים, או שהצלמת לא הגדירה קישורי תשלום
  payment: { amount: number; settled: boolean; links: PaymentLinks } | null;
}

// פוקוס ו-visibilitychange מגיעים לרוב יחד - לא לטעון פעמיים באותו רגע
const MIN_REFRESH_INTERVAL_MS = 5000;

export function useClientGalleryProgress(galleryId: string): ClientGalleryProgress | null {
  const [data, setData] = useState<ClientGalleryProgress | null>(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (inFlightRef.current) return;
      if (!force && now - lastFetchRef.current < MIN_REFRESH_INTERVAL_MS) return;
      inFlightRef.current = true;
      lastFetchRef.current = now;
      try {
        const res = await fetch(`/api/gallery/${galleryId}/progress`, { cache: 'no-store' });
        if (!res.ok) return; // שקט - הקומפוננטה פשוט לא מוצגת/נשארת במצב האחרון
        setData(await res.json());
      } catch {
        // אין חיבור - ננסה שוב בפוקוס הבא
      } finally {
        inFlightRef.current = false;
      }
    },
    [galleryId]
  );

  useEffect(() => {
    load(true);
    const handleFocus = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [load]);

  return data;
}
