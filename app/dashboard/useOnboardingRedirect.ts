'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ONBOARDING_LOCAL_KEY,
  ONBOARDING_REDIRECTED_SESSION_KEY,
  WELCOME_PATH,
  isOnboardingExemptPath,
  shouldRedirectToWelcome,
} from '@/lib/onboarding';

interface OnboardingStatus {
  onboardingDone: boolean | null;
  galleryCount: number | null;
}

function readStorage(storage: 'local' | 'session', key: string): boolean {
  try {
    return (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key) === '1';
  } catch {
    return false;
  }
}

// בדיקה קלה בצד הדפדפן (נקראת מ-app/dashboard/layout.tsx): צלמת חדשה - בלי
// גלריות ובלי שסיימה את האשף - מופנית פעם אחת ל-/dashboard/welcome. הסטטוס
// נטען פעם אחת לכל טעינת layout (לא בכל ניווט), ההחלטה עצמה ב-lib/onboarding.ts.
// כל שגיאה = לא מפנים.
export function useOnboardingRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const statusRef = useRef<Promise<OnboardingStatus | null> | null>(null);

  useEffect(() => {
    if (isOnboardingExemptPath(pathname)) return;
    if (readStorage('local', ONBOARDING_LOCAL_KEY) || readStorage('session', ONBOARDING_REDIRECTED_SESSION_KEY)) return;

    if (!statusRef.current) {
      statusRef.current = fetch('/api/photographer/onboarding')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }

    let cancelled = false;
    statusRef.current.then((status) => {
      if (cancelled || !status) return;
      const redirect = shouldRedirectToWelcome({
        pathname,
        onboardingDone: status.onboardingDone,
        localDone: readStorage('local', ONBOARDING_LOCAL_KEY),
        galleryCount: status.galleryCount,
        alreadyRedirectedThisSession: readStorage('session', ONBOARDING_REDIRECTED_SESSION_KEY),
      });
      if (!redirect) return;
      try {
        window.sessionStorage.setItem(ONBOARDING_REDIRECTED_SESSION_KEY, '1');
      } catch {
        // בלי sessionStorage - עדיין לא תהיה לולאה: האשף עצמו פטור מההפניה
      }
      router.replace(WELCOME_PATH);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);
}
