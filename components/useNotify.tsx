'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { theme } from '@/lib/theme';
import {
  type NotifyAction,
  type NotifyItem,
  type NotifyType,
  enqueueNotification,
  notifyDuration,
  pickVisible,
  removeNotification,
  removeNotificationsByKey,
} from '@/lib/notifyQueue';

// הודעות מאוחדות לגלריית הלקוח/ה (app/gallery/[id]/page.tsx) - במקום הרבה
// טוסטים/שורות סטטוס נפרדים: תור אחד (lib/notifyQueue.ts), הודעה אחת גלויה
// בכל רגע לפי עדיפות, קבועה מעל הפס התחתון, נעלמת לבד לפי סוג, ואופציונלית
// עם כפתור פעולה ("בטל" / "נסי שוב"). באנרים קבועים (תוקף/הארכה/המשך/אופליין)
// נשארים בעמוד עצמו - זה רק להודעות חולפות.

export interface NotifyOptions {
  type: NotifyType;
  message: string;
  key?: string;
  action?: NotifyAction;
  durationMs?: number;
}

export interface Notifier {
  queue: readonly NotifyItem[];
  notify: (options: NotifyOptions) => number;
  dismiss: (id: number) => void;
  dismissKey: (key: string) => void;
}

export function useNotify(): Notifier {
  const [queue, setQueue] = useState<NotifyItem[]>([]);
  const nextIdRef = useRef(0);

  const notify = useCallback((options: NotifyOptions) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    const now = Date.now();
    setQueue((q) => enqueueNotification(q, { ...options, id, createdAt: now }, now));
    return id;
  }, []);
  const dismiss = useCallback((id: number) => setQueue((q) => removeNotification(q, id)), []);
  const dismissKey = useCallback((key: string) => setQueue((q) => removeNotificationsByKey(q, key)), []);

  return useMemo(() => ({ queue, notify, dismiss, dismissKey }), [queue, notify, dismiss, dismissKey]);
}

const TYPE_COLOR: Record<NotifyType, string> = {
  error: theme.errorText,
  warning: theme.warningText,
  success: theme.successText,
  info: theme.textMuted,
};

interface NotifyHostProps {
  notifier: Notifier;
  // מרחק מתחתית המסך (CSS) - מעל הפס התחתון / פס הבחירה בתצוגה המוגדלת
  bottom: string;
  closeLabel: string;
  accent: string;
  dir?: 'rtl' | 'ltr';
}

export function NotifyHost({ notifier, bottom, closeLabel, accent, dir }: NotifyHostProps) {
  const { queue, dismiss } = notifier;
  const visible = pickVisible(queue);
  // ריחוף/פוקוס על ההודעה עוצרים את הספירה לאחור - כדי שאפשר יהיה לקרוא
  // ולהגיע לכפתור הפעולה
  const [paused, setPaused] = useState(false);

  const visibleId = visible?.id ?? null;
  const duration = visible ? notifyDuration(visible) : 0;
  useEffect(() => {
    if (visibleId === null || paused) return;
    const t = setTimeout(() => dismiss(visibleId), duration);
    return () => clearTimeout(t);
  }, [visibleId, paused, duration, dismiss]);

  // הודעה חדשה מתחילה תמיד בלי השהיה
  useEffect(() => {
    setPaused(false);
  }, [visibleId]);

  const isError = visible?.type === 'error';

  const toast = visible && (
    <div
      key={visible.id}
      className="notify-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      style={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem',
        width: 'max-content', maxWidth: '100%', margin: '0 auto',
        background: 'rgba(22,28,45,0.97)', color: theme.text,
        border: `1px solid ${visible.type === 'info' ? `${accent}88` : TYPE_COLOR[visible.type]}`,
        borderInlineStartWidth: 4,
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: '0.3rem', paddingInlineStart: '0.9rem',
        fontSize: 14, lineHeight: 1.45,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: visible.type === 'info' ? theme.text : TYPE_COLOR[visible.type], padding: '0.35rem 0' }}>
        {visible.message}
      </span>
      {visible.action && (
        <button
          type="button"
          onClick={() => {
            const action = visible.action;
            dismiss(visible.id);
            action?.run();
          }}
          style={{
            flexShrink: 0, minHeight: 40, padding: '0.3rem 0.9rem', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${accent}`, background: 'transparent', color: accent,
            fontWeight: 700, fontSize: 13, fontFamily: theme.fontSans, whiteSpace: 'nowrap',
          }}
        >
          {visible.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(visible.id)}
        aria-label={closeLabel}
        title={closeLabel}
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: '50%', border: 'none',
          background: 'transparent', color: theme.textMuted, fontSize: 15, cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );

  // שני אזורי aria-live שקיימים תמיד ב-DOM (כדי שקוראי מסך יכריזו על תוכן
  // חדש): polite לכל ההודעות, assertive רק לשגיאות
  const regionStyle: React.CSSProperties = { width: '100%' };
  return (
    <div
      dir={dir}
      style={{
        position: 'fixed', insetInline: 0, bottom, zIndex: 90, pointerEvents: 'none',
        padding: '0 1rem', display: 'flex', justifyContent: 'center',
      }}
    >
      <style>{`
        @keyframes notify-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .notify-toast { animation: notify-in 0.2s ease-out; }
        @media (prefers-reduced-motion: reduce) { .notify-toast { animation: none; } }
      `}</style>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div role="status" aria-live="polite" aria-atomic="true" style={regionStyle}>
          {!isError && toast}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true" style={regionStyle}>
          {isError && toast}
        </div>
      </div>
    </div>
  );
}
