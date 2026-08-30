import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Frank_Ruhl_Libre, Assistant } from 'next/font/google';

// אותם גופנים כמו בעיצוב הרפרנס (דינה שוורץ) - serif אלגנטי לכותרות, sans לגוף הטקסט
const serif = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '700'], variable: '--font-serif' });
const sans = Assistant({ subsets: ['hebrew', 'latin'], weight: ['300', '400', '500', '600', '700'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Photo Selection App',
};

// Next.js מזריק ברירת מחדל (width=device-width) גם בלי זה, אבל בלי
// initial-scale=1 יש דפדפנים ניידים שמתחילים מזוזמים - במיוחד קריטי כאן כי
// מסך הגלריה של הלקוחה הוא בעיקר mobile-first (קוד גישה, בחירת תמונות בנייד)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${serif.variable} ${sans.variable}`}>
      <body style={{ background: '#0f1626', color: '#efe8db', fontFamily: 'var(--font-sans), sans-serif', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
