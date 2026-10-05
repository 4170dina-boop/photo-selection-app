import { redirect } from 'next/navigation';

type SearchParams = Record<string, string | string[] | undefined>;

// פרמטרים שקישורי האימות של Supabase מוסיפים. אם redirectTo לא היה ברשימת
// ה-Redirect URLs המורשים, Supabase נופל ל-Site URL (הדף הזה) - ובלי העברה
// ל-/auth/callback הקוד היה הולך לאיבוד והצלמת הייתה נתקעת ב-/login בלי session.
const FORWARDED_PARAMS = ['code', 'next', 'error', 'error_code', 'error_description'];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function RootPage({ searchParams }: { searchParams: SearchParams }) {
  const code = first(searchParams.code);
  const error = first(searchParams.error);

  if (code || error) {
    const params = new URLSearchParams();
    for (const key of FORWARDED_PARAMS) {
      const value = first(searchParams[key]);
      if (value) params.set(key, value);
    }
    // next ייבדק שוב ב-/auth/callback (lib/safeNext.ts)
    redirect(`/auth/callback?${params.toString()}`);
  }

  redirect('/login');
}
