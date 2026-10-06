'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { theme } from '@/lib/theme';
import { evaluateSetupChecklist, summarizeChecklist, type ChecklistItem, type SetupChecklistInput } from '@/lib/setupChecklist';

// "השלמת הגדרות" - כרטיס קטן בראש "היום" ו"הגלריות שלי". כל סעיף מסומן
// אוטומטית לפי הנתונים (lib/setupChecklist.ts), בלי שהצלמת צריכה לסמן ידנית.
// ניתן לקפל ולהסתיר (נשמר בדפדפן בלבד), ונעלם לבד כשכל המשימות הושלמו.

const DISMISSED_KEY = 'setupChecklistDismissed';
const COLLAPSED_KEY = 'setupChecklistCollapsed';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // בכוונה שקט - רק נוחות
  }
}

function getJson(url: string) {
  return fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

export default function SetupChecklist() {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [dismissed, setDismissed] = useState(true); // עד שקוראים את הדגל - לא מהבהבים
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setDismissed(readFlag(DISMISSED_KEY));
    setCollapsed(readFlag(COLLAPSED_KEY));
    if (readFlag(DISMISSED_KEY)) return;

    let cancelled = false;
    Promise.all([getJson('/api/photographer'), getJson('/api/photographer/onboarding'), getJson('/api/photographer/capabilities')]).then(
      ([photographer, onboarding, capabilities]) => {
        if (cancelled) return;
        const input: SetupChecklistInput = {
          photographer,
          realGalleryCount: typeof onboarding?.realGalleryCount === 'number' ? onboarding.realGalleryCount : null,
          capabilities: capabilities && typeof capabilities.ai === 'boolean' ? capabilities : null,
        };
        setItems(evaluateSetupChecklist(input));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !items) return null;
  const summary = summarizeChecklist(items);
  if (summary.totalTasks === 0 || summary.allDone) return null;

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    writeFlag(COLLAPSED_KEY, next);
  }

  function dismiss() {
    setDismissed(true);
    writeFlag(DISMISSED_KEY, true);
  }

  const percent = Math.round((summary.doneCount / summary.totalTasks) * 100);

  return (
    <section
      aria-label="השלמת הגדרות"
      style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '0.75rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: theme.text, cursor: 'pointer', textAlign: 'right', padding: 0, fontFamily: theme.fontSans }}
        >
          <div style={{ fontWeight: 'bold', fontSize: 15 }}>
            {collapsed ? '◂' : '▾'} השלמת הגדרות · {summary.doneCount}/{summary.totalTasks}
          </div>
          <div style={{ height: 4, background: theme.border, borderRadius: 2, marginTop: '0.45rem', overflow: 'hidden' }}>
            <div style={{ width: `${percent}%`, height: '100%', background: theme.gold }} />
          </div>
        </button>
        <button
          onClick={dismiss}
          aria-label="הסתרת רשימת ההגדרות"
          style={{ background: 'none', border: 'none', color: theme.textFaint, cursor: 'pointer', fontSize: 13, padding: '0.25rem' }}
        >
          הסתירי
        </button>
      </div>

      {!collapsed && (
        <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[...summary.tasks, ...summary.warnings].map((item) => (
            <li key={item.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  background: item.done ? theme.successBg : item.kind === 'info' ? theme.warningBg : 'transparent',
                  color: item.done ? theme.successText : theme.warningText,
                  border: item.done || item.kind === 'info' ? 'none' : `1px solid ${theme.borderLight}`,
                }}
              >
                {item.done ? '✓' : item.kind === 'info' ? 'i' : ''}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: item.done ? theme.textMuted : theme.text, textDecoration: item.done ? 'line-through' : 'none' }}>
                  {item.href && !item.done ? (
                    <Link href={item.href} style={{ color: theme.text }}>
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                  {item.kind === 'info' && <span style={{ fontSize: 12, color: theme.textFaint }}> (מידע)</span>}
                </div>
                {!item.done && <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.1rem' }}>{item.hint}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
