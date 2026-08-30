'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { theme, inputStyle, goldButtonStyle } from '@/lib/theme';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    // הקישור במייל מוביל ל-auth/callback (אותו endpoint ששימש עד עכשיו רק
    // לאימות הרשמה) שממיר קוד ל-session ואז מפנה ל-login/reset-password,
    // שם הצלם קובע סיסמה חדשה בזמן שיש לו session תקף (recovery).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/login/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError('שליחת המייל נכשלה, נסי שוב');
      return;
    }

    // תמיד מציגים הודעת הצלחה, גם אם המייל לא קיים במערכת - כדי לא לחשוף
    // אילו כתובות מייל רשומות (user enumeration).
    setSent(true);
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 360, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ fontSize: 22, marginBottom: '1.5rem', color: theme.gold }}>שחזור סיסמה</h1>

        {sent ? (
          <p style={{ background: theme.successBg, color: theme.successText, padding: '0.75rem 1rem', borderRadius: 8 }}>
            אם הכתובת רשומה במערכת, נשלח אליה מייל עם קישור לאיפוס הסיסמה. בדקי את תיבת הדואר.
          </p>
        ) : (
          <>
            <p style={{ color: theme.textMuted, marginBottom: '1.5rem', fontSize: 14 }}>
              הזיני את כתובת המייל שאיתה נרשמת, ונשלח לך קישור לקביעת סיסמה חדשה.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <input
                type="email"
                placeholder="אימייל"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                required
              />
              <button type="submit" disabled={loading} style={{ ...goldButtonStyle, opacity: loading ? 0.6 : 1 }}>
                {loading ? 'שולחת...' : 'שליחת קישור לאיפוס'}
              </button>
            </form>

            {error && (
              <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1.25rem' }}>
                {error}
              </p>
            )}
          </>
        )}

        <Link href="/login" style={{ display: 'block', marginTop: '1.5rem', fontSize: 13, color: theme.textMuted }}>
          חזרה להתחברות
        </Link>
      </div>
    </div>
  );
}
