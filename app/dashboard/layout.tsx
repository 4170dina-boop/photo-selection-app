'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { theme, outlineButtonStyle } from '@/lib/theme';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div style={{ direction: 'rtl', minHeight: '100vh', background: theme.bg, color: theme.text }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <Link href="/dashboard/galleries" style={{ fontWeight: 'bold', color: theme.gold, textDecoration: 'none' }}>
          ✨ אזור צלמים
        </Link>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link href="/dashboard/galleries" style={{ ...outlineButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
            הגלריות שלי
          </Link>
          <Link href="/dashboard/settings" style={{ ...outlineButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
            הגדרות
          </Link>
          <button onClick={handleSignOut} style={outlineButtonStyle}>
            התנתקות
          </button>
        </div>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
