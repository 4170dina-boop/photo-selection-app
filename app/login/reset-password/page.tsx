'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { theme, inputStyle, goldButtonStyle } from '@/lib/theme';
import { updatePasswordErrorMessage } from '@/lib/authErrors';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // null = עוד בודקים; false = אין session (קישור שפג/נפתח בדפדפן אחר/גלישה ישירה)
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setHasSession(Boolean(data.user)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('הסיסמאות לא תואמות');
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // ה-session כאן הוא "recovery" - נוצר ב-auth/callback מהקישור שבמייל
    // (ראו app/login/forgot-password/page.tsx). updateUser עובד רק כי יש
    // session תקף מסוג הזה, בלי צורך בסיסמה הישנה.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updatePasswordErrorMessage(updateError));
      return;
    }

    router.push('/dashboard/today');
    router.refresh();
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 360, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ fontSize: 22, marginBottom: '1.5rem', color: theme.gold }}>קביעת סיסמה חדשה</h1>

        {hasSession === null && <p style={{ color: theme.textMuted }}>רגע...</p>}

        {hasSession === false && (
          <>
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8 }}>
              קישור האיפוס פג תוקף או שכבר נעשה בו שימוש. בקשי קישור חדש ונסי שוב.
            </p>
            <Link href="/login/forgot-password" style={{ display: 'block', marginTop: '1.25rem', color: theme.gold }}>
              שליחת קישור איפוס חדש
            </Link>
          </>
        )}

        {hasSession && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <input
            type="password"
            placeholder="סיסמה חדשה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            minLength={6}
            required
          />
          <input
            type="password"
            placeholder="אימות סיסמה חדשה"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
            minLength={6}
            required
          />
          <button type="submit" disabled={loading} style={{ ...goldButtonStyle, opacity: loading ? 0.6 : 1 }}>
            {loading ? 'שומרת...' : 'עדכון סיסמה'}
          </button>
        </form>
        )}

        {error && (
          <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1.25rem' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
