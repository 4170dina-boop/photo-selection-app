'use client';

import { theme } from '@/lib/theme';

// שלד טעינה לגלריית הלקוח/ה (app/gallery/[id]/page.tsx) במקום "טוען גלריה..." -
// כותרת, תיבת פרטים וגריד אריחים בצורת הגלריה האמיתית, עם הבהוב עדין שנעצר
// לגמרי למי שביקשה להפחית תנועה. הטקסט עצמו נשאר לקוראי מסך בלבד.
const TILE_COUNT = 12;

export default function GallerySkeleton({ label, dir, lang }: { label: string; dir?: 'rtl' | 'ltr'; lang?: string }) {
  return (
    <div
      dir={dir}
      lang={lang}
      aria-busy="true"
      style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: theme.fontSans }}
    >
      <style>{`
        @keyframes gsk-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        .gsk { background: ${theme.panelInput}; border-radius: 6px; animation: gsk-pulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gsk { animation: none; opacity: 0.8; } }
      `}</style>
      <p role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: -1 }}>
        {label}
      </p>
      <div aria-hidden="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 1.5rem', borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="gsk" style={{ width: 110, height: 34 }} />
            <div className="gsk" style={{ width: 64, height: 34 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="gsk" style={{ width: 56, height: 16 }} />
            <div className="gsk" style={{ width: 44, height: 44, borderRadius: '50%' }} />
          </div>
        </div>
        <div className="gsk" style={{ margin: '0.75rem 1.5rem 0', height: 38, borderRadius: 8 }} />
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 45vw), 1fr))',
            gap: '1rem', padding: '1.25rem 1.5rem 1.5rem',
          }}
        >
          {Array.from({ length: TILE_COUNT }, (_, i) => (
            <div key={i} className="gsk" style={{ aspectRatio: '4 / 3', animationDelay: `${(i % 4) * 0.12}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
