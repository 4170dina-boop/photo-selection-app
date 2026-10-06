'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { LANG_NAME, SUPPORTED_LANGS, type Lang } from '@/lib/i18n';

// תפריט "⋯ עוד" בכותרת גלריית הלקוח/ה (app/gallery/[id]/page.tsx): פעולות
// משניות (השוואה, סקירה ברצף, ביטול כל הבחירה, עזרה מ-AI) ובורר השפה - במקום
// שורת כפתורים ארוכה. תפריט נגיש לפי דפוס ה-menu button של WAI-ARIA:
// aria-haspopup/expanded על הכפתור, role="menu" עם פריטים שהפוקוס עובר
// ביניהם בחצים (roving focus), Home/End, Escape סוגר ומחזיר פוקוס לכפתור,
// Tab/קליק בחוץ סוגרים.

export interface MoreMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  // פעולה הרסנית (ביטול כל הבחירה) - בצבע שגיאה
  danger?: boolean;
}

interface GalleryMoreMenuProps {
  label: string;
  ariaLabel: string;
  items: MoreMenuItem[];
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  languageLabel: string;
  accent: string;
  buttonClassName?: string;
}

export default function GalleryMoreMenu({
  label,
  ariaLabel,
  items,
  lang,
  onLangChange,
  languageLabel,
  accent,
  buttonClassName,
}: GalleryMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // לאיזה פריט להעביר פוקוס מיד אחרי הפתיחה ('first' / 'last')
  const focusOnOpenRef = useRef<'first' | 'last'>('first');
  const baseId = useId();
  const menuId = `${baseId}-menu`;

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  // פוקוס לפריט הראשון/האחרון כשהתפריט נפתח
  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    const target = focusOnOpenRef.current === 'last' ? list[list.length - 1] : list[0];
    target?.focus();
  }, [open]);

  // קליק/מגע מחוץ לתפריט סוגר אותו (בלי להחזיר פוקוס - המשתמש/ת כבר במקום אחר)
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function openWith(focus: 'first' | 'last') {
    focusOnOpenRef.current = focus;
    setOpen(true);
  }

  function handleButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openWith('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWith('last');
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % list.length;
    else if (e.key === 'ArrowUp') next = index <= 0 ? list.length - 1 : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === 'Tab') {
      // יוצאים מהתפריט בזרימת ה-Tab הרגילה
      setOpen(false);
      return;
    }
    if (next === null || list.length === 0) return;
    e.preventDefault();
    list[next].focus();
  }

  function activate(item: MoreMenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  }

  const itemStyle = (danger?: boolean, disabled?: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: 44,
    padding: '0.5rem 0.9rem', border: 'none', background: 'transparent', textAlign: 'start',
    color: danger ? theme.errorText : theme.text, fontSize: 14, fontFamily: theme.fontSans,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, borderRadius: 6,
  });

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <style>{`
        .gmm-item:hover:not([aria-disabled="true"]), .gmm-item:focus-visible { background: ${theme.panelInput}; outline: none; }
        .gmm-item:focus-visible { box-shadow: inset 0 0 0 2px ${accent}; }
      `}</style>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={handleButtonKeyDown}
        style={{
          ...outlineButtonStyle,
          borderColor: open ? accent : theme.border, color: open ? accent : theme.textMuted,
        }}
      >
        {label}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', insetInlineStart: 0, zIndex: 60,
            minWidth: 230, maxWidth: 'calc(100vw - 24px)', padding: '0.35rem',
            background: theme.panel, border: `1px solid ${theme.borderLight}`, borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="gmm-item"
              aria-disabled={item.disabled || undefined}
              onClick={() => activate(item)}
              style={itemStyle(item.danger, item.disabled)}
            >
              {item.label}
            </button>
          ))}

          {/* בורר השפה כקבוצת פריטי רדיו בתוך התפריט */}
          <div role="group" aria-label={languageLabel} style={{ borderTop: items.length > 0 ? `1px solid ${theme.border}` : undefined, marginTop: items.length > 0 ? '0.3rem' : 0, paddingTop: items.length > 0 ? '0.3rem' : 0 }}>
            <div aria-hidden="true" style={{ fontSize: 11, color: theme.textFaint, padding: '0.2rem 0.9rem' }}>
              🌐 {languageLabel}
            </div>
            {SUPPORTED_LANGS.map((code) => {
              const selected = code === lang;
              return (
                <button
                  key={code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={-1}
                  lang={code}
                  className="gmm-item"
                  onClick={() => {
                    close(true);
                    if (!selected) onLangChange(code);
                  }}
                  style={{ ...itemStyle(), color: selected ? accent : theme.text, fontWeight: selected ? 700 : 400 }}
                >
                  <span aria-hidden="true" style={{ width: 14, display: 'inline-block' }}>{selected ? '✓' : ''}</span>
                  {LANG_NAME[code]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
