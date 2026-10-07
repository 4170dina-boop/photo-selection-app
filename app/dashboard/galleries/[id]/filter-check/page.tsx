'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { theme, goldButtonStyle, outlineButtonStyle, headingStyle } from '@/lib/theme';
import { classifyFilterResult, summarizeFilterStates, type FilterState } from '@/lib/filterCheck';

// "הכנה לסינון": הצלמת (שגולשת בעצמה דרך סינון) פותחת את הדף אחרי ההעלאה.
// הדף טוען כל תמונה בכתובת הקבועה שלה - אותה כתובת בדיוק שהלקוחה תקבל
// (lib/stablePhotoUrl.ts) - וכך התמונות נשלחות לבדיקת הסינון לפני שהלקוחה
// בכלל נכנסת. הדף בודק שוב אוטומטית כל כמה דקות ומראה כמה כבר עברו.

type PhotoItem = { id: string; number: number; url: string; expectedBytes: number | null };

const FETCH_CONCURRENCY = 6;
const RECHECK_INTERVAL_MS = 3 * 60 * 1000;

async function measure(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.blob()).size;
  } catch {
    return null;
  }
}

export default function FilterCheckPage({ params }: { params: { id: string } }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, FilterState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    fetch(`/api/galleries/${params.id}/filter-check`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'טעינה נכשלה');
        setPhotos(data.photos);
        setClientName(data.clientName);
      })
      .catch((e) => setLoadError(e.message));
  }, [params.id]);

  // בודקים שוב רק תמונות שעוד לא עברו - מה שכבר עבר לא חוזר אחורה.
  const runCheck = useCallback(async (items: PhotoItem[], current: Record<string, FilterState>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const todo = items.filter((p) => current[p.id] !== 'passed');
    setStates((prev) => {
      const next = { ...prev };
      todo.forEach((p) => (next[p.id] = 'checking'));
      return next;
    });
    for (let i = 0; i < todo.length; i += FETCH_CONCURRENCY) {
      const chunk = todo.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (p) => [p.id, classifyFilterResult(p.expectedBytes, await measure(p.url))] as const));
      setStates((prev) => {
        const next = { ...prev };
        results.forEach(([id, s]) => (next[id] = s));
        return next;
      });
    }
    setLastCheck(new Date());
    runningRef.current = false;
    setRunning(false);
  }, []);

  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    if (photos.length === 0) return;
    runCheck(photos, {});
    const timer = setInterval(() => {
      if (!summarizeFilterStates(photos.map((p) => statesRef.current[p.id] ?? 'checking')).allPassed) {
        runCheck(photos, statesRef.current);
      }
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [photos, runCheck]);

  const summary = summarizeFilterStates(photos.map((p) => states[p.id] ?? 'checking'));
  const percent = summary.total ? Math.round((summary.passed / summary.total) * 100) : 0;
  const held = photos.filter((p) => states[p.id] === 'held');

  return (
    <div dir="rtl" style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 16px', color: theme.text, fontFamily: theme.fontSans }}>
      <Link href={`/dashboard/galleries/${params.id}/edit`} style={{ color: theme.textMuted, fontSize: 14 }}>
        → חזרה לגלריה
      </Link>
      <h1 style={{ ...headingStyle, marginTop: '0.75rem' }}>הכנה לסינון{clientName ? ` · ${clientName}` : ''}</h1>
      <p style={{ color: theme.textMuted, lineHeight: 1.7, fontSize: 15 }}>
        הדף הזה שולח את כל התמונות לבדיקת הסינון <b>לפני</b> שהלקוחה מקבלת קישור. כל תמונה נבדקת פעם אחת, ואחר כך היא
        מאושרת לכל מי שנכנס. אפשר להשאיר את הדף פתוח: הוא בודק שוב לבד כל 3 דקות.
      </p>

      {loadError && <p style={{ color: '#e07a6e' }}>{loadError}</p>}

      {photos.length > 0 && (
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: '1rem', margin: '1rem 0', background: theme.panel }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {summary.allPassed ? '✓ כל התמונות עברו את הסינון. אפשר לשלוח ללקוחה' : `${summary.passed} מתוך ${summary.total} תמונות עברו את הסינון`}
          </div>
          <div style={{ height: 10, borderRadius: 5, background: theme.border, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ width: `${percent}%`, height: '100%', background: theme.gold, transition: 'width 0.3s' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" style={summary.allPassed ? outlineButtonStyle : goldButtonStyle} disabled={running} onClick={() => runCheck(photos, states)}>
              {running ? 'בודקת…' : 'בדיקה חוזרת עכשיו'}
            </button>
            {lastCheck && (
              <span style={{ fontSize: 13, color: theme.textMuted }}>
                בדיקה אחרונה: {lastCheck.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      )}

      {held.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '1.25rem 0 0.5rem' }}>עדיין בבדיקה ({held.length})</h2>
          <p style={{ fontSize: 14, color: theme.textMuted, margin: '0 0 0.5rem' }}>מספרי התמונות לפי הסדר שהלקוחה רואה:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {held.map((p) => (
              <span key={p.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '4px 10px', fontSize: 14 }}>
                {p.number}
              </span>
            ))}
          </div>
        </>
      )}

      {photos.length === 0 && !loadError && <p style={{ color: theme.textMuted }}>טוענת…</p>}
    </div>
  );
}
