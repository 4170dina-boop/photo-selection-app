'use client';

import { useEffect, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import EmailInput from '@/components/EmailInput';

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

  const [fromEmail, setFromEmail] = useState('');
  const [fromEmailInput, setFromEmailInput] = useState('');
  const [savingFromEmail, setSavingFromEmail] = useState(false);
  const [fromEmailMessage, setFromEmailMessage] = useState('');

  // ה-user id של המנהלת - רק כשהניהול עוד לא נעול ל-ADMIN_USER_ID (ראו
  // isAdminLockedToUserId ב-lib/adminCheck.ts), כדי להציג המלצה לנעול אותו.
  const [unlockedAdminUserId, setUnlockedAdminUserId] = useState<string | null>(null);
  const [copiedUserId, setCopiedUserId] = useState(false);

  useEffect(() => {
    loadPhotographers();
    loadSettings();
    loadAdminLock();
  }, []);

  async function loadAdminLock() {
    const res = await fetch('/api/admin/me').catch(() => null);
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    if (data?.isAdmin && !data.lockedToUserId && typeof data.userId === 'string') {
      setUnlockedAdminUserId(data.userId);
    }
  }

  async function copyUserId() {
    if (!unlockedAdminUserId) return;
    try {
      await navigator.clipboard.writeText(unlockedAdminUserId);
      setCopiedUserId(true);
      setTimeout(() => setCopiedUserId(false), 2000);
    } catch {
      // אין הרשאת לוח - ה-id מוצג ממילא וניתן לסמן ולהעתיק ידנית
    }
  }

  async function loadSettings() {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) return;
    const data = await res.json();
    setFromEmail(data.resendFromEmail ?? '');
    setFromEmailInput(data.resendFromEmail ?? '');
  }

  async function saveFromEmail() {
    setFromEmailMessage('');
    setSavingFromEmail(true);

    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resendFromEmail: fromEmailInput.trim() }),
    });

    setSavingFromEmail(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFromEmailMessage(data.error || 'העדכון נכשל');
      return;
    }

    setFromEmail(fromEmailInput.trim());
    setFromEmailMessage('נשמר ✓ - מיילים חדשים יישלחו מהכתובת הזו');
  }

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

      {unlockedAdminUserId && (
        <div style={{ background: theme.panel, border: `1px solid ${theme.gold}`, borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.35rem' }}>
            🔒 מומלץ לנעול את הניהול לחשבון שלך: הוסיפי ב-Vercel משתנה <span dir="ltr">ADMIN_USER_ID</span> = ה-user id שלמטה
          </div>
          <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '0.75rem' }}>
            כרגע כל מי שנרשמת ומתחברת עם כתובת המנהלת מקבלת גישת ניהול. אחרי ההוספה (ו-Redeploy) רק החשבון הזה יוכל לנהל.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <code
              dir="ltr"
              style={{
                flex: '1 1 240px', padding: '0.5rem 0.75rem', borderRadius: 8, border: `1px solid ${theme.border}`,
                background: theme.bg, color: theme.text, fontSize: 13, userSelect: 'all', wordBreak: 'break-all',
              }}
            >
              {unlockedAdminUserId}
            </code>
            <button onClick={copyUserId} style={{ ...outlineButtonStyle, padding: '0.5rem 1.1rem', fontSize: 13 }}>
              {copiedUserId ? 'הועתק ✓' : 'העתקה'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.35rem' }}>כתובת שליחת מיילים</div>
        <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '0.75rem' }}>
          הכתובת שממנה נשלחים כל המיילים (תזכורות, הזמנות לגלריה וכו'). כרגע: <b>{fromEmail || 'טוען...'}</b>.
          אחרי שיש דומיין מאומת ב-Resend, אפשר לעדכן כאן בלי לגעת בהגדרות ב-Vercel.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <EmailInput
            value={fromEmailInput}
            onValueChange={setFromEmailInput}
            placeholder="hello@your-domain.co.il"
            style={{
              flex: '1 1 240px', padding: '0.5rem 0.75rem', borderRadius: 8,
              border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, fontSize: 14,
            }}
          />
          <button
            onClick={saveFromEmail}
            disabled={savingFromEmail || !fromEmailInput.trim() || fromEmailInput.trim() === fromEmail}
            style={{ ...goldButtonStyle, padding: '0.5rem 1.1rem', fontSize: 13, opacity: savingFromEmail ? 0.6 : 1 }}
          >
            {savingFromEmail ? 'שומר...' : 'שמירה'}
          </button>
        </div>
        {fromEmailMessage && (
          <p style={{ marginTop: '0.5rem', fontSize: 13, color: fromEmailMessage.startsWith('נשמר') ? theme.successText : theme.errorText }}>
            {fromEmailMessage}
          </p>
        )}
      </div>

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
