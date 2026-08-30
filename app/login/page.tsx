'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { theme, inputStyle, goldButtonStyle } from '@/lib/theme';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard/galleries';

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');

  function switchMode(newMode: 'login' | 'signup') {
    setMode(newMode);
    setError('');
    setConfirmMessage('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setConfirmMessage('');
    setLoading(true);

    const supabase = createClient();

    if (mode === 'login') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);

      if (signInError) {
        setError('אימייל או סיסמה שגויים');
        return;
      }

      router.push(next);
      router.refresh();
      return;
    }

    // הרשמה - שם העסק נשמר ב-user metadata, וטריגר ב-DB (handle_new_photographer,
    // ראו supabase/schema.sql) יוצר ממנו את שורת ה-photographers אוטומטית.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { business_name: businessName || 'ללא שם' } },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message === 'User already registered' ? 'כתובת המייל כבר רשומה' : 'שגיאה בהרשמה');
      return;
    }

    if (data.session) {
      // אימות מייל כבוי בפרויקט - יש session מיד
      router.push(next);
      router.refresh();
      return;
    }

    // אימות מייל דלוק (ברירת המחדל ב-Supabase) - צריך לאשר לפני שיש session
    setConfirmMessage('נרשמת בהצלחה! בדקי את תיבת המייל שלך ולחצי על קישור האישור כדי להתחבר.');
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 360, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ fontSize: 22, marginBottom: '2rem', color: theme.gold }}>✨ אזור צלמים</h1>

        <div
          style={{
            display: 'flex', marginBottom: '1.5rem', border: `1px solid ${theme.border}`,
            borderRadius: 8, overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => switchMode('login')}
            style={{
              flex: 1, padding: '0.6rem', cursor: 'pointer', border: 'none',
              background: mode === 'login' ? theme.gold : 'transparent',
              color: mode === 'login' ? theme.goldText : theme.text,
              fontWeight: mode === 'login' ? 'bold' : 'normal',
            }}
          >
            התחברות
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            style={{
              flex: 1, padding: '0.6rem', cursor: 'pointer', border: 'none',
              background: mode === 'signup' ? theme.gold : 'transparent',
              color: mode === 'signup' ? theme.goldText : theme.text,
              fontWeight: mode === 'signup' ? 'bold' : 'normal',
            }}
          >
            הרשמה
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="שם העסק"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              style={inputStyle}
              required
            />
          )}
          <input
            type="email"
            placeholder="אימייל"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            required
          />
          <input
            type="password"
            placeholder="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            minLength={6}
            required
          />
          <button type="submit" disabled={loading} style={{ ...goldButtonStyle, marginTop: '0.5rem', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'רגע...' : mode === 'login' ? 'התחברות' : 'הרשמה'}
          </button>
        </form>

        {error && (
          <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1.25rem' }}>
            {error}
          </p>
        )}
        {confirmMessage && (
          <p style={{ background: theme.successBg, color: theme.successText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1.25rem' }}>
            {confirmMessage}
          </p>
        )}
      </div>
    </div>
  );
}
