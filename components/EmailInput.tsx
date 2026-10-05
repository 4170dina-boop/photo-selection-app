'use client';

import { useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { theme } from '@/lib/theme';
import { emailSuggestions } from '@/lib/emailSuggest';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

// שדה מייל עם השלמה: Tab, לחיצה, או Enter אחרי ניווט בחיצים משלימים להצעה
// המסומנת (@gmail.com, .co.il וכו'). Tab כשאין הצעה - מעבר שדה רגיל.
export default function EmailInput({ value, onValueChange, style, onKeyDown, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);

  const suggestions = emailSuggestions(value);
  const open = focused && !dismissed && suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);

  // מאפייני פריסה (flex וכו') עוברים לעוטף, כדי שהרכיב יתנהג כמו ה-input שהחליף
  const { flex, flexGrow, flexBasis, minWidth, maxWidth, width, ...inputOwnStyle } = style ?? {};
  const wrapperStyle: CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', flex, flexGrow, flexBasis, minWidth, maxWidth, width };

  function change(v: string) {
    onValueChange(v);
    setActive(0);
    setNavigated(false);
    setDismissed(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || !open) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      change(suggestions[activeIndex]);
    } else if (e.key === 'Enter' && navigated) {
      e.preventDefault();
      change(suggestions[activeIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setNavigated(true);
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setNavigated(true);
      setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Escape') {
      setDismissed(true);
    }
  }

  return (
    <div style={wrapperStyle}>
      <input
        {...rest}
        type="email"
        dir="ltr"
        autoComplete={rest.autoComplete ?? 'email'}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={{ ...inputOwnStyle, width: '100%', boxSizing: 'border-box', textAlign: value ? 'left' : 'right' }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2,
            background: theme.panel, border: `1px solid ${theme.borderLight}`, borderRadius: 4,
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)', overflow: 'hidden',
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={s}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown ולא click - כדי שהשדה לא יאבד פוקוס לפני הבחירה
              onMouseDown={(e) => { e.preventDefault(); change(s); }}
              onMouseEnter={() => setActive(i)}
              dir="ltr"
              style={{
                padding: '0.45rem 0.85rem', fontSize: 14, cursor: 'pointer', textAlign: 'left',
                display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                background: i === activeIndex ? theme.panelInput : 'transparent',
                color: theme.text, fontFamily: theme.fontSans,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
              {i === activeIndex && <span style={{ color: theme.textFaint, fontSize: 12, flexShrink: 0 }}>Tab</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
