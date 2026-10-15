'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { UploadProvider } from './UploadProvider';
import { useOnboardingRedirect } from './useOnboardingRedirect';
import { isGalleryColors, type GalleryColors } from '@/lib/galleryTheme';
import { THEME_CHANGED_EVENT, applyThemeVars } from '@/lib/applyTheme';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  // הכפתור של הדף הנוכחי מודגש (כולל תתי-דפים, למשל עריכת גלריה תחת "הגלריות שלי")
  const navStyle = (href: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return {
      ...outlineButtonStyle,
      textDecoration: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      ...(active ? { color: theme.gold, borderColor: theme.gold } : {}),
    };
  };
  const [isAdmin, setIsAdmin] = useState(false);
  useOnboardingRedirect(); // צלמת חדשה -> אשף הפתיחה (פעם אחת, ראו lib/onboarding.ts)

  // העיצוב שהצלמת בחרה (הגדרות -> עיצוב) חל גם על אזור הצלמת, לא רק על הגלריה
  const [colors, setColors] = useState<GalleryColors | null>(null);
  useEffect(() => {
    fetch('/api/photographer')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setColors(isGalleryColors(data?.custom_theme) ? data.custom_theme : null))
      .catch(() => {});
    const onChange = (e: Event) => {
      const next = (e as CustomEvent).detail;
      setColors(isGalleryColors(next) ? next : null);
    };
    window.addEventListener(THEME_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
  }, []);
  useEffect(() => (colors ? applyThemeVars(colors) : undefined), [colors]);

  // כפתור "ניהול צלמות" מוצג רק למנהלת (ADMIN_EMAIL) - שאר הצלמות לא רואות אותו
  useEffect(() => {
    fetch('/api/admin/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsAdmin(!!data?.isAdmin))
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    // UploadProvider עוטף כאן (לא בתוך דף ההעלאה עצמו) כי app/dashboard/layout.tsx
    // הוא ה-layout המשותף לכל /dashboard/* - הוא נשאר מורכב (mounted) לאורך כל
    // ניווט פנימי בין דפי הדשבורד, כך שתור ההעלאה בתוך ה-context לא מתאפס
    // כשעוברים מדף ההעלאה לדף אחר, גם אם דף ההעלאה עצמו כן מתפרק/נטען מחדש
    // (למשל כשה-galleryId ב-URL משתנה).
    <UploadProvider>
      <div style={{ direction: 'rtl', minHeight: '100vh', background: theme.bg, color: theme.text }}>
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
            padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.border}`,
            // סרגל דביק: נשאר למעלה בגלילה. רקע אטום + zIndex כדי שהתוכן לא
            // ייראה מבעדו, ו-maxHeight+scroll ליתר ביטחון אם התפריט נשבר להרבה שורות בנייד.
            position: 'sticky', top: 0, zIndex: 20, background: theme.bg,
            maxHeight: '100vh', overflowY: 'auto',
          }}
        >
          <Link href="/dashboard/today" style={{ fontWeight: 'bold', color: theme.gold, textDecoration: 'none' }}>
            ✨ אזור צלמים
          </Link>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link href="/dashboard/today" style={navStyle('/dashboard/today')} aria-current={pathname.startsWith('/dashboard/today') ? 'page' : undefined}>
              היום
            </Link>
            <Link href="/dashboard/galleries" style={navStyle('/dashboard/galleries')} aria-current={pathname.startsWith('/dashboard/galleries') ? 'page' : undefined}>
              הגלריות שלי
            </Link>
            <Link href="/dashboard/clients" style={navStyle('/dashboard/clients')} aria-current={pathname.startsWith('/dashboard/clients') ? 'page' : undefined}>
              לקוחות
            </Link>
            <Link href="/dashboard/calendar" style={navStyle('/dashboard/calendar')} aria-current={pathname.startsWith('/dashboard/calendar') ? 'page' : undefined}>
              יומן צילומים
            </Link>
            <Link href="/dashboard/reports" style={navStyle('/dashboard/reports')} aria-current={pathname.startsWith('/dashboard/reports') ? 'page' : undefined}>
              דוח הכנסות
            </Link>
            <Link href="/dashboard/analytics" style={navStyle('/dashboard/analytics')} aria-current={pathname.startsWith('/dashboard/analytics') ? 'page' : undefined}>
              אנליטיקס
            </Link>
            <Link href="/dashboard/settings" style={navStyle('/dashboard/settings')} aria-current={pathname.startsWith('/dashboard/settings') ? 'page' : undefined}>
              הגדרות
            </Link>
            {isAdmin && (
              <Link href="/dashboard/admin" style={navStyle('/dashboard/admin')} aria-current={pathname.startsWith('/dashboard/admin') ? 'page' : undefined}>
                ניהול צלמות
              </Link>
            )}
            <button onClick={handleSignOut} style={outlineButtonStyle}>
              התנתקות
            </button>
          </div>
        </div>

        <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>{children}</div>
      </div>
    </UploadProvider>
  );
}
