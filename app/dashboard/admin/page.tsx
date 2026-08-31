'use client';

import { useEffect, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

interface PhotographerRow {
  id: string;
  businessName: string;
  email: string | null;
  isUnlimited: boolean;
  createdAt: string;
}

// פאנל ניהול פנימי - נגיש רק דרך URL ישיר (אין קישור בתפריט, כדי לא לבלבל
// צלמות רגילות), ומוגן שוב בצד שרת לפי ADMIN_EMAIL (ראו lib/requireAdmin.ts)
// - זה לא הגנה אמיתית בפני עצמה, רק נוחות; ה-API הוא שאוכף בפועל.
export default function AdminPage() {
  const [rows, setRows] = useState<PhotographerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPhotographers();
  }, []);

  async function loadPhotographers() {
    setLoading(true);
    const res = await fetch('/api/admin/photographers');

    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError('טעינת הרשימה נכשלה');
      setLoading(false);
      return;
    }

    const data = await res.json();
    setRows(data.photographers ?? []);
    setLoading(false);
  }

  async function toggleUnlimited(row: PhotographerRow) {
    setError('');
    setUpdatingId(row.id);

    const res = await fetch(`/api/admin/photographers/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isUnlimited: !row.isUnlimited }),
    });

    setUpdatingId(null);

    if (!res.ok) {
      setError('העדכון נכשל, נסי שוב');
      return;
    }

    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isUnlimited: !r.isUnlimited } : r)));
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  if (forbidden) {
    return <p style={{ color: theme.errorText }}>אין לך הרשאה לעמוד הזה.</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>ניהול צלמות</h1>
      <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1.5rem' }}>
        אחרי שצלמת שילמה על מנוי (דרך Grow), סמני אותה כאן כ"ללא הגבלה" - זה מסיר את מגבלת
        הגלריה-הפעילה-האחת ומגבלת 25 התמונות (`enforce_active_gallery_limit`/`enforce_photo_limit`
        ב-`supabase/schema.sql`).
      </p>

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.map((row) => (
          <div
            key={row.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
              padding: '0.85rem 1rem', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 'bold' }}>{row.businessName}</div>
              <div style={{ fontSize: 13, color: theme.textMuted }}>{row.email ?? 'ללא אימייל'}</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: 13, color: row.isUnlimited ? theme.successText : theme.textFaint }}>
                {row.isUnlimited ? 'ללא הגבלה' : 'חשבון חינמי'}
              </span>
              <button
                onClick={() => toggleUnlimited(row)}
                disabled={updatingId === row.id}
                style={{
                  ...(row.isUnlimited ? outlineButtonStyle : goldButtonStyle),
                  padding: '0.4rem 0.9rem', fontSize: 13,
                  opacity: updatingId === row.id ? 0.6 : 1,
                }}
              >
                {updatingId === row.id ? 'מעדכן...' : row.isUnlimited ? 'הסרת הגבלה מיוחדת' : 'סימון כללא הגבלה'}
              </button>
            </div>
          </div>
        ))}

        {rows.length === 0 && <p style={{ color: theme.textMuted }}>אין עדיין צלמות רשומות.</p>}
      </div>
    </div>
  );
}
