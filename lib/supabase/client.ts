import { createBrowserClient } from '@supabase/ssr';

// לקוח Supabase לרכיבי 'use client'. שומר את ה-session (אחרי התחברות עם
// Supabase Auth) בעוגיות רגילות - לא httpOnly - כדי שגם ה-middleware בצד
// שרת וגם הדפדפן יראו את אותו session. זה מה שמאפשר ל-RLS שמבוסס על
// auth.uid() (ראו supabase/schema.sql) לעבוד גם מהדפדפן, בניגוד לעוגיית
// gallery_session_* של הלקוחות (שם httpOnly זה בדיוק הרצוי - ראו lib/session.ts).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  );
}
