'use client';

import { useState } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';
import type { Lang } from '@/lib/i18n/types';
import type { Gender } from '@/lib/gender';
import {
  buildGalleryUrl,
  buildStageMessageHtml,
  buildStageMessageText,
  MESSAGE_STAGES,
  MESSAGE_STAGE_LABELS,
  type MessageStage,
  type MessageTone,
} from '@/lib/clientInviteMessage';
import { copyToClipboard } from './clipboard';

// "💬 הודעות מוכנות" - תפריט ליד כפתור ההעתקה של הזמנה: תזכורת עדינה /
// התחלתי לערוך / הגלריה נפתחה מחדש / התמונות מוכנות, בגרסה חמה או רשמית.
// מעתיק טקסט (וואטסאפ) + HTML ממותג (ג'ימייל/אאוטלוק), בשפת הגלריה ובלשון
// הפנייה של הלקוח/ה. ההודעות: lib/clientInviteMessage.ts + lib/i18n/*/stages.ts.
// מוחזר כ-fragment כדי לשבת בתוך שורת הכפתורים (flex-wrap) - התפריט עצמו
// תופס שורה מלאה.
interface StageMessagesMenuProps {
  galleryId: string;
  accessCode: string;
  clientName?: string | null;
  clientGender?: Gender;
  language?: Lang;
  expiresAt?: string | null;
  businessName?: string;
  logoUrl?: string;
  deliveredCount?: number;
}

export default function StageMessagesMenu(props: StageMessagesMenuProps) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<MessageTone>('warm');
  const [copiedStage, setCopiedStage] = useState<MessageStage | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  async function handleCopy(stage: MessageStage) {
    const params = {
      stage,
      tone,
      clientName: props.clientName,
      clientGender: props.clientGender,
      language: props.language,
      galleryUrl: buildGalleryUrl(process.env.NEXT_PUBLIC_SITE_URL || window.location.origin, props.galleryId),
      accessCode: props.accessCode,
      expiresAt: props.expiresAt,
      businessName: props.businessName,
      logoUrl: props.logoUrl,
      deliveredCount: props.deliveredCount,
    };
    const text = buildStageMessageText(params);
    if (await copyToClipboard(text, buildStageMessageHtml(params))) {
      setFallbackText(null);
      setCopiedStage(stage);
      setTimeout(() => setCopiedStage((current) => (current === stage ? null : current)), 2000);
    } else {
      setFallbackText(text);
    }
  }

  const toneButton = (value: MessageTone, label: string) => (
    <button
      type="button"
      onClick={() => setTone(value)}
      aria-pressed={tone === value}
      style={{
        ...outlineButtonStyle,
        padding: '0.25rem 0.7rem',
        fontSize: 12.5,
        borderColor: tone === value ? theme.gold : theme.border,
        color: tone === value ? theme.gold : theme.textMuted,
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="הודעות מוכנות לפי שלב - להעתקה ושליחה בוואטסאפ או במייל"
        style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}
      >
        💬 הודעות מוכנות {open ? '▴' : '▾'}
      </button>

      {open && (
        <div
          style={{
            flexBasis: '100%',
            width: '100%',
            background: theme.panelInput,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12.5, color: theme.textMuted }}>
            סגנון:
            {toneButton('warm', 'חם')}
            {toneButton('formal', 'רשמי')}
          </div>
          {MESSAGE_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => handleCopy(stage)}
              style={{ ...outlineButtonStyle, textAlign: 'start', padding: '0.45rem 0.8rem', fontSize: 13 }}
            >
              {copiedStage === stage ? 'הועתק! ✓' : MESSAGE_STAGE_LABELS[stage]}
            </button>
          ))}
          {fallbackText !== null && (
            <textarea
              readOnly
              dir="auto"
              value={fallbackText}
              onFocus={(e) => e.currentTarget.select()}
              rows={Math.min(10, fallbackText.split('\n').length + 1)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: theme.panel,
                color: theme.text,
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                fontFamily: theme.fontSans,
                fontSize: 13.5,
                lineHeight: 1.6,
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
