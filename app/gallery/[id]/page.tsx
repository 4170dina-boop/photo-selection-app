'use client';

import React, { useEffect, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

interface GalleryPageProps {
  params: { id: string };
}

interface GalleryPhoto {
  id: string;
  thumbnailUrl: string | null;
  fullUrl: string | null;
  original_filename: string;
}

// בוחר טקסט כהה/בהיר לפי בהירות צבע המותג, כדי שכפתורים יישארו קריאים
// גם אם הצלמת בוחרת צבע מותג כהה (ולא רק את הגוון הבהיר של הפלטה המקורית).
function contrastTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return theme.goldText;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? theme.goldText : '#ffffff';
}

export default function GalleryPage({ params }: GalleryPageProps) {
  const galleryId = params.id;

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [statuses, setStatuses] = useState<Record<string, 'maybe' | 'selected'>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [packageInfo, setPackageInfo] = useState<{ included: number; extraPrice: number } | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<string>('sent');
  const [finishing, setFinishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brandColor, setBrandColor] = useState<string | null>(null);

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  // הטעינה עצמה היא גם בדיקת האימות: העוגייה httpOnly ולא ניתנת לקריאה
  // מ-JS, אז אי אפשר "לבדוק אם קיימת" מראש - פשוט מנסים לטעון, ו-401 אומר שצריך קוד גישה.
  async function loadGallery() {
    setLoading(true);
    setCheckingAuth(true);

    const res = await fetch(`/api/gallery/${galleryId}`);

    if (res.status === 401) {
      setAuthorized(false);
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setActionError('שגיאה בטעינת הגלריה. נסי לרענן.');
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

    const data = await res.json();

    setPhotos(data.photos ?? []);
    setStatuses(
      Object.fromEntries(
        (data.selections ?? []).map((s: any) => [s.photo_id, (s.status as 'maybe' | 'selected') ?? 'selected'])
      )
    );
    setNotes(
      Object.fromEntries((data.selections ?? []).filter((s: any) => s.note).map((s: any) => [s.photo_id, s.note as string]))
    );
    setPackageInfo(data.package ?? null);
    setGalleryStatus(data.status ?? 'sent');
    setBrandColor(data.brandColor ?? null);

    setAuthorized(true);
    setCheckingAuth(false);
    setLoading(false);
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');

    const res = await fetch('/api/verify-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ galleryId, accessCode: codeInput.trim() }),
    });

    if (res.ok) {
      await loadGallery();
    } else {
      const data = await res.json();
      setAuthError(data.error ?? 'שגיאה באימות');
    }
  }

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: theme.textMuted }}>טוען...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleSubmitCode} style={{ maxWidth: 320, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
          <p style={{ marginBottom: '1.25rem', color: theme.gold, fontSize: 18 }}>✨ הזיני את קוד הגישה שקיבלת</p>
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center', fontSize: 18, letterSpacing: 1 }}
            autoFocus
          />
          <button type="submit" style={{ ...goldButtonStyle, width: '100%' }}>
            כניסה לגלריה
          </button>
          {authError && (
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
              {authError}
            </p>
          )}
        </form>
      </div>
    );
  }

  async function cycleStatus(photoId: string) {
    if (galleryStatus === 'completed') return; // הבחירה כבר נשלחה - נעול לעריכה

    const current = statuses[photoId]; // undefined | 'maybe' | 'selected'
    const next = current === undefined ? 'maybe' : current === 'maybe' ? 'selected' : null;

    const res = await fetch(`/api/gallery/${galleryId}/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, status: next }),
    });

    if (!res.ok) {
      setActionError('העדכון לא נשמר, נסי שוב.');
      return;
    }
    setActionError('');

    const nextStatuses = { ...statuses };
    if (next === null) {
      delete nextStatuses[photoId];
      setNotes((prev) => {
        const { [photoId]: _, ...rest } = prev;
        return rest;
      });
    } else {
      nextStatuses[photoId] = next;
    }
    setStatuses(nextStatuses);
  }

  function openNoteEditor(photoId: string, e: React.MouseEvent) {
    e.stopPropagation(); // לא לגעת בבחירה עצמה
    if (galleryStatus === 'completed') return;
    setNoteEditingId(photoId);
    setNoteDraft(notes[photoId] ?? '');
  }

  async function handleFinish() {
    if (!window.confirm('לשלוח את הבחירה? אחרי זה לא ניתן יהיה לשנות אותה.')) return;

    setFinishing(true);
    const res = await fetch(`/api/gallery/${galleryId}/finish`, { method: 'POST' });
    setFinishing(false);

    if (!res.ok) {
      setActionError('שליחת הבחירה נכשלה, נסי שוב.');
      return;
    }

    setActionError('');
    setGalleryStatus('completed');
  }

  async function saveNote() {
    if (!noteEditingId) return;
    const trimmed = noteDraft.trim();

    const res = await fetch(`/api/gallery/${galleryId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: noteEditingId, note: trimmed }),
    });

    if (!res.ok) {
      setActionError('ההערה לא נשמרה, נסי שוב.');
      return;
    }
    setActionError('');

    setNotes((prev) => {
      if (!trimmed) {
        const { [noteEditingId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [noteEditingId]: trimmed };
    });
    setNoteEditingId(null);
  }

  function toggleCompareSelect(photoId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCompareIds((prev) => {
      if (prev.includes(photoId)) return prev.filter((id) => id !== photoId);
      if (prev.length >= 2) return [prev[1], photoId]; // מחליף את הישן ביותר
      return [...prev, photoId];
    });
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>טוען גלריה...</p>
      </div>
    );
  }

  const selectedCount = Object.values(statuses).filter((s) => s === 'selected').length;
  const maybeCount = Object.values(statuses).filter((s) => s === 'maybe').length;
  const overIncluded = packageInfo ? Math.max(0, selectedCount - packageInfo.included) : 0;
  const extraCost = packageInfo ? overIncluded * packageInfo.extraPrice : 0;
  const progressPct = packageInfo && packageInfo.included > 0
    ? Math.min(100, Math.round((selectedCount / packageInfo.included) * 100))
    : 0;

  // "צבע מותג": אם הצלמת לא הגדירה אחד בהגדרות, נשארים עם הפלטה המקורית
  // (theme.gold/goldBright) - ראו app/api/gallery/[id]/route.ts.
  const accent = brandColor ?? theme.goldBright;
  const accentSolid = brandColor ?? theme.gold;
  const accentText = brandColor ? contrastTextColor(brandColor) : theme.goldText;
  const primaryButtonStyle = brandColor
    ? { ...goldButtonStyle, background: brandColor, color: accentText }
    : goldButtonStyle;

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', color: theme.text, direction: 'rtl', fontFamily: theme.fontSans }}>
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.border}`, flexWrap: 'wrap', gap: '1rem',
          background: 'rgba(15,22,38,0.92)',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: theme.green, display: 'inline-block' }} />
            אולי
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent, display: 'inline-block' }} />
            נבחר
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div>
              נבחרו במסגרת החבילה{' '}
              <b style={{ color: accent, fontFamily: theme.fontSerif }}>{packageInfo?.included ?? 0}</b> / {selectedCount}
            </div>
            <div style={{ fontSize: 12, color: theme.textFaint }}>{maybeCount} תמונות "אולי"</div>
          </div>
          <div
            style={{
              width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 'bold', color: accent, fontFamily: theme.fontSerif,
              background: `conic-gradient(${accentSolid} ${progressPct}%, ${theme.panelInput} ${progressPct}%)`,
            }}
          >
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {progressPct}%
            </div>
          </div>
        </div>
      </div>

      {overIncluded > 0 && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.warningBg, color: theme.warningText, fontSize: 14 }}>
          עברת ב-{overIncluded} תמונות מהחבילה — עלות נוספת: {extraCost.toFixed(2)} ₪
        </div>
      )}

      {actionError && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.errorBg, color: theme.errorText, fontSize: 14 }}>
          {actionError}
        </div>
      )}

      {galleryStatus === 'completed' && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.successBg, color: theme.successText, fontSize: 14, textAlign: 'center' }}>
          ✓ הבחירה נשלחה. אפשר עדיין לצפות בתמונות, אבל לא לשנות את הבחירה.
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 13, color: theme.textFaint, padding: '0.75rem 0 0' }}>
        תמונות מוגנות בסימן מים · הורדה וגרירה חסומות בגלריה האמיתית
      </p>

      <div style={{ padding: '0 1.5rem 1rem', textAlign: 'center' }}>
        <button
          onClick={() => {
            setCompareMode((prev) => !prev);
            setCompareIds([]);
          }}
          style={{ ...outlineButtonStyle, marginTop: '0.5rem' }}
        >
          {compareMode ? 'צאי ממצב השוואה' : '⇄ השוואה בין 2 תמונות'}
        </button>
        {compareMode && <span style={{ marginRight: '0.5rem', fontSize: 13, color: theme.textMuted }}>בחרי שתי תמונות להשוואה ({compareIds.length}/2)</span>}

        {galleryStatus !== 'completed' && (
          <button
            onClick={handleFinish}
            disabled={finishing || selectedCount === 0}
            title={selectedCount === 0 ? 'בחרי לפחות תמונה אחת קודם' : undefined}
            style={{
              ...primaryButtonStyle,
              display: 'block', margin: '0.75rem auto 0',
              opacity: finishing || selectedCount === 0 ? 0.5 : 1,
            }}
          >
            {finishing ? 'שולחת...' : 'סיימתי לבחור ✓'}
          </button>
        )}
      </div>

      {compareMode && compareIds.length === 2 && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem',
          }}
          onClick={() => setCompareIds([])}
        >
          {compareIds.map((id) => {
            const photo = photos.find((p) => p.id === id);
            if (!photo || !photo.fullUrl) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={id}
                src={photo.fullUrl}
                alt=""
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  maxHeight: '90vh', maxWidth: '45%', objectFit: 'contain', borderRadius: 6,
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />
            );
          })}
        </div>
      )}

      {noteEditingId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setNoteEditingId(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 320, border: `1px solid ${theme.border}` }}>
            <p style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.75rem' }}>הערה לתמונה</p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              style={{ ...inputStyle, width: '100%' }}
              placeholder="למשל: את זו רוצה בשחור-לבן"
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={saveNote} style={{ ...goldButtonStyle, padding: '0.5rem 1rem' }}>שמירה</button>
              <button onClick={() => setNoteEditingId(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1rem',
          padding: '0 1.5rem 1.5rem',
        }}
      >
        {photos.map((photo) => {
          const status = statuses[photo.id]; // undefined | 'maybe' | 'selected'
          const isComparing = compareIds.includes(photo.id);
          const hasNote = !!notes[photo.id];

          const borderColor = isComparing
            ? theme.compare
            : status === 'selected'
            ? accent
            : status === 'maybe'
            ? theme.green
            : 'transparent';

          const heartBg = status === 'selected' ? accent : status === 'maybe' ? theme.green : 'rgba(10,10,11,0.6)';
          const heartFilled = status !== undefined;
          const heartColor = status === 'selected' ? accentText : heartFilled ? theme.goldText : '#fff';

          return (
            <div
              key={photo.id}
              onClick={(e) => (compareMode ? toggleCompareSelect(photo.id, e) : cycleStatus(photo.id))}
              onContextMenu={(e) => e.preventDefault()} // חסימת קליק ימני - הרתעה בלבד, לא הגנה אמיתית
              style={{
                position: 'relative',
                cursor: compareMode || galleryStatus !== 'completed' ? 'pointer' : 'default',
                border: `2px solid ${borderColor}`,
                borderRadius: 6,
                overflow: 'hidden',
                background: theme.panel,
              }}
            >
              <div
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 1,
                  background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 10,
                  padding: '2px 7px', borderRadius: 10,
                }}
              >
                {photo.original_filename}
              </div>

              {!compareMode && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleStatus(photo.id);
                  }}
                  title="לחיצה: מחזור בין אולי / נבחר / כלום"
                  style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 1,
                    background: heartBg, border: '1px solid rgba(255,255,255,0.3)', color: heartColor,
                    borderRadius: '50%', width: 30, height: 30,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  {heartFilled ? '♥' : '♡'}
                </div>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.thumbnailUrl ?? ''}
                alt=""
                draggable={false}
                style={{
                  width: '100%', display: 'block', pointerEvents: 'none', aspectRatio: '3/4', objectFit: 'cover',
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />

              {status && (
                <button
                  onClick={(e) => openNoteEditor(photo.id, e)}
                  title="הוסיפי הערה"
                  style={{
                    position: 'absolute', bottom: 8, left: 8,
                    background: hasNote ? theme.goldBright : 'rgba(255,255,255,0.85)',
                    border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
                  }}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
