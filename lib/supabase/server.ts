import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// לקוח Supabase ל-Server Components / Route Handlers / Server Actions.
// קורא את ה-session מהעוגיות של הבקשה, כדי ש-RLS מבוסס auth.uid() יעבוד
// גם בצד שרת (למשל ב-app/auth/callback/route.ts).
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // נקרא מתוך Server Component - אי אפשר לכתוב עוגיות שם.
            // ה-middleware דואג לרענון ה-session בפועל, אז זה בסדר להתעלם.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // ראו הערה למעלה
          }
        },
      },
    }
  );
}
