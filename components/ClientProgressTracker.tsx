'use client';

import React from 'react';
import { theme, goldButtonStyle } from '@/lib/theme';
import { formatIsraelDate } from '@/lib/israelTime';
import type { ClientProgressStep } from '@/lib/clientProgress';
import { useClientGalleryProgress } from '@/components/useClientGalleryProgress';
import { ClientPayPanel } from '@/components/ClientPayButton';

// "מה הבא?" - מעקב התקדמות ללקוחה אחרי "סיימתי לבחור": בחרת תמונות ->
// הצלמת עורכת -> התמונות מוכנות (lib/clientProgress.ts). הנתונים מ-
// app/api/gallery/[id]/progress, מתרעננים כשהעמוד חוזר לפוקוס. מוצג גם
// בביקורים מאוחרים יותר (גלריה נעולה / צפייה בלבד). כולל גם את "תשלום על
// התוספת" (ClientPayButton) כשהצלמת הגדירה קישורי תשלום.

// TODO i18n: להעביר ל-lib/i18n
const STRINGS = {
  title: 'מה הבא?',
  steps: {
    selected: '✓ בחרת תמונות',
    editing: '✏️ הצלמת עורכת',
    ready: '📦 התמונות מוכנות',
  } as Record<ClientProgressStep, string>,
  copy: {
    selected: (name: string | null) => `הבחירה שלך אצל ${name ?? 'הצלמת'} 💛 השלב הבא הוא עריכת התמונות - נעדכן כאן ברגע שזה מתחיל.`,
    editing: (name: string | null) => `${name ?? 'הצלמת'} התחילה לערוך את התמונות שלך 💛 עוד קצת סבלנות - זה שווה את זה.`,
    ready: () => 'התמונות הסופיות שלך מוכנות! 🎉',
  },
  deliveredOn: (date: string) => `נמסרו ב-${date}`,
  goToDelivered: '📥 לצפייה והורדה',
  stepLabel: (i: number, total: number, label: string, current: boolean) =>
    `שלב ${i} מתוך ${total}: ${label}${current ? ' (השלב הנוכחי)' : ''}`,
};

// id של אזור התמונות הסופיות בעמוד הגלריה (app/gallery/[id]/page.tsx)
export const DELIVERED_SECTION_ID = 'delivered-photos';

interface Props {
  galleryId: string;
  photographerName?: string | null;
  accent?: string;
  buttonStyle?: React.CSSProperties;
  // true = עם מסגרת משלו (כשלא בתוך פאנל התודה, למשל במצב צפייה בלבד)
  framed?: boolean;
}

export default function ClientProgressTracker({ galleryId, photographerName = null, accent = theme.gold, buttonStyle = goldButtonStyle, framed }: Props) {
  const data = useClientGalleryProgress(galleryId);
  const progress = data?.progress;
  if (!data || !progress) return null;

  function goToDelivered() {
    const el = document.getElementById(DELIVERED_SECTION_ID);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // התמונות נמסרו אחרי שהעמוד נטען - טעינה מחדש תציג את אזור ההורדה
      window.location.reload();
    }
  }

  const copy =
    progress.current === 'ready' ? STRINGS.copy.ready() : STRINGS.copy[progress.current](photographerName);
  const total = progress.steps.length;

  const body = (
    <div style={{ marginTop: framed ? 0 : '1.25rem', textAlign: 'center' }}>
      <p style={{ fontFamily: theme.fontSerif, fontSize: 17, color: theme.text, margin: '0 0 0.75rem' }}>{STRINGS.title}</p>

      <ol
        style={{
          listStyle: 'none', padding: 0, margin: '0 auto', maxWidth: 460,
          display: 'flex', alignItems: 'stretch', gap: '0.35rem',
        }}
      >
        {progress.steps.map((step, i) => {
          const active = step.current;
          const color = active ? accent : step.done ? theme.text : theme.textFaint;
          return (
            <li
              key={step.key}
              aria-current={active ? 'step' : undefined}
              aria-label={STRINGS.stepLabel(i + 1, total, STRINGS.steps[step.key], active)}
              style={{
                flex: 1, minWidth: 0, padding: '0.55rem 0.35rem', borderRadius: 10, fontSize: 13, lineHeight: 1.35,
                color, fontWeight: active ? 700 : 400,
                background: active ? `${accent}1f` : 'transparent',
                border: `1px solid ${active ? accent : step.done ? theme.borderLight : theme.border}`,
                opacity: !active && !step.done ? 0.75 : 1,
              }}
            >
              {STRINGS.steps[step.key]}
            </li>
          );
        })}
      </ol>

      <p role="status" style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 420, margin: '0.85rem auto 0' }}>
        {copy}
      </p>

      {progress.current === 'ready' && data.deliveredAt && (
        <p style={{ color: theme.textFaint, fontSize: 12, margin: '0.25rem 0 0' }}>{STRINGS.deliveredOn(formatIsraelDate(data.deliveredAt))}</p>
      )}

      {progress.current === 'ready' && data.deliveredCount > 0 && (
        <button type="button" onClick={goToDelivered} style={{ ...buttonStyle, marginTop: '0.75rem', minHeight: 44 }}>
          {STRINGS.goToDelivered}
        </button>
      )}

      {data.payment && !data.payment.settled && (
        <ClientPayPanel amount={data.payment.amount} links={data.payment.links} accent={accent} buttonStyle={buttonStyle} />
      )}
    </div>
  );

  if (!framed) return body;
  return (
    <div
      style={{
        margin: '1rem 1.5rem 0', padding: '1.25rem 1.5rem', borderRadius: 14,
        background: theme.panel, border: `1px solid ${theme.border}`,
      }}
    >
      {body}
    </div>
  );
}
