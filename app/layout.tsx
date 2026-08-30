import type { ReactNode } from 'react';

export const metadata = {
  title: 'Photo Selection App',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
