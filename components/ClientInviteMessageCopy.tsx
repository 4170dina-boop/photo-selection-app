'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import type { Lang } from '@/lib/i18n/types';
import { buildGalleryUrl, buildInviteMessageHtml, buildInviteMessageText } from '@/lib/clientInviteMessage';
import type { Gender } from '@/lib/gender';

// כפתור "✎ העתקת הודעה מוכנה לשליחה" - גיבוי ידני (וואטסאפ/מייל רגיל) למייל
// ההזמנה האוטומטי. מעתיק גם טקסט רגיל וגם HTML מעוצב באותה פעולה
// (navigator.clipboard.write עם שני ה-MIME types) - וואטסאפ ואפליקציות טקסט
// פשוט משתמשות בגרסת הטקסט, וג'ימייל/אאוטלוק מדביקים את ה-HTML המעוצב.
// דפדפן בלי ClipboardItem נופל לטקסט בלבד; בלי navigator.clipboard בכלל
// (HTTP לא מאובטח/הרשאה נדחתה) - מוצגת תיבת טקסט מסומנת להעתקה ידנית.
// ההודעה עצמה: lib/clientInviteMessage.ts.
//
// מוחזר כ-fragment כדי שהכפתור ישב בתוך שורת כפתורים קיימת (flex-wrap);
// ההתראה ותיבת הגיבוי תופסות שורה מלאה (flexBasis 100%).
interface ClientInviteMessageCopyProps {
  galleryId: string;
  accessCode: string;
  clientName?: string | null;
  // לשון הפנייה בהודעה ("מה תבחרי" / "מה תבחר") - ברירת מחדל נקבה
  clientGender?: Gender;
  // שפת הגלריה (galleries.language) - ההודעה נבנית בשפה הזו, ברירת מחדל עברית
  language?: Lang;
  expiresAt?: string | null;
  // שניהם undefined = הקומפוננטה טוענת בעצמה מ-/api/photographer
  businessName?: string;
  logoUrl?: string;
  // true כשמייל ההזמנה האוטומטי לא נשלח - מציג התראה מעל הכפתור
  emailFailed?: boolean;
  // כפתור זהב מלא (מסך "הגלריה נוצרה!") במקום מסגרת זהב
  prominent?: boolean;
}

export default function ClientInviteMessageCopy({
  galleryId,
  accessCode,
  clientName,
  clientGender,
  language,
  expiresAt,
  businessName,
  logoUrl,
  emailFailed,
  prominent,
}: ClientInviteMessageCopyProps) {
  const shouldLoadBrand = businessName === undefined && logoUrl === undefined;
  const [loadedBrand, setLoadedBrand] = useState({ businessName: '', logoUrl: '' });
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [manualHint, setManualHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!shouldLoadBrand) return;
    let cancelled = false;
    fetch('/api/photographer')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setLoadedBrand({ businessName: data.business_name ?? '', logoUrl: data.logo_url ?? '' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shouldLoadBrand]);

  // אחרי שתיבת הגיבוי מוצגת: מסמנים את הטקסט ומנסים execCommand('copy')
  useEffect(() => {
    if (fallbackText === null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    if (ok) markCopied();
    else setManualHint(true);
  }, [fallbackText]);

  function markCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopy() {
    const params = {
      clientName,
      clientGender,
      language,
      galleryUrl: buildGalleryUrl(process.env.NEXT_PUBLIC_SITE_URL || window.location.origin, galleryId),
      accessCode,
      expiresAt,
      businessName: shouldLoadBrand ? loadedBrand.businessName : businessName,
      logoUrl: shouldLoadBrand ? loadedBrand.logoUrl : logoUrl,
    };
    const message = buildInviteMessageText(params);
    setManualHint(false);

    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([message], { type: 'text/plain' }),
            'text/html': new Blob([buildInviteMessageHtml(params)], { type: 'text/html' }),
          }),
        ]);
      } catch {
        await navigator.clipboard.writeText(message);
      }
      setFallbackText(null);
      markCopied();
    } catch {
      setFallbackText(message);
    }
  }

  const buttonStyle: CSSProperties = prominent
    ? goldButtonStyle
    : { ...outlineButtonStyle, padding: '0.5rem 1rem', borderColor: theme.gold, color: theme.gold };

  return (
    <>
      {emailFailed && (
        <p style={{ flexBasis: '100%', background: theme.warningBg, color: theme.warningText, padding: '0.6rem 1rem', borderRadius: 8, margin: '0 0 0.75rem' }}>
          המייל לא נשלח - אפשר להעתיק את ההודעה המעוצבת ולשלוח בעצמך (וואטסאפ/מייל)
        </p>
      )}

      <button
        type="button"
        onClick={handleCopy}
        title="הודעה מוכנה עם ברכה, קישור וקוד - להדביק בוואטסאפ כטקסט, או בג'ימייל/אאוטלוק בתור מייל מעוצב"
        style={buttonStyle}
      >
        {copied ? 'הועתק!' : '✎ העתקת הודעה מוכנה לשליחה'}
      </button>

      {fallbackText !== null && (
        <div style={{ flexBasis: '100%', width: '100%', marginTop: '0.5rem' }}>
          {manualHint && (
            <div style={{ fontSize: 12.5, color: theme.warningText, marginBottom: '0.35rem' }}>
              ההעתקה האוטומטית לא זמינה בדפדפן הזה - ההודעה מסומנת, אפשר להעתיק ידנית (Ctrl+C / לחיצה ארוכה).
            </div>
          )}
          <textarea
            ref={textareaRef}
            readOnly
            dir="rtl"
            value={fallbackText}
            onFocus={(e) => e.currentTarget.select()}
            rows={Math.min(12, fallbackText.split('\n').length + 1)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: theme.panelInput,
              color: theme.text,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: '0.65rem 0.85rem',
              fontFamily: theme.fontSans,
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
        </div>
      )}
    </>
  );
}
