'use client';

import { useEffect, useRef } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { NO_CHAPTER, chapterProgress, type Chapter } from '@/lib/chapters';

// ניווט בגלריות גדולות בצד הלקוחה (app/gallery/[id]/page.tsx):
// - שורת צ'יפים של פרקים ("הכל · 💍 חופה (120) ✓ · 💃 ריקודים (340)") עם
//   התקדמות לכל פרק (כמה נצפו/נבחרו) ו-✓ כשצפתה בכל הפרק.
// - מתג "הסתרת הדומות" - מכל רצף תמונות דומות נשארת אחת (הנבחרת, או הראשונה).
// - BurstBadge ("📚 3 דומות") על כרטיס שהוא חלק מרצף, ו-BurstChooser - חלון
//   שמציג את כל הרצף זה לצד זה כדי לבחור "✓ זו הכי טובה".
// הכל מוסתר כשאין נתונים (אין פרקים / אין רצפים / המיגרציה לא רצה).
// הנתונים: chapters + photos[].chapterId/burstId מ-app/api/gallery/[id].

// TODO i18n - להעביר ל-lib/i18n כשהוא יגיע ל-main
const S = {
  chaptersLabel: 'פרקים',
  all: 'הכל',
  noChapter: 'שאר התמונות',
  viewedAll: 'צפית בכל התמונות בפרק הזה',
  progress: (viewed: number, total: number, selected: number) =>
    `נצפו ${viewed}/${total}${selected > 0 ? ` · נבחרו ${selected}` : ''}`,
  hideSimilar: '📚 הסתרת הדומות',
  hideSimilarHint: 'מכל רצף של תמונות כמעט זהות תוצג רק אחת - הנבחרת, או הראשונה',
  similarBadge: (n: number) => `📚 ${n} דומות`,
  similarBadgeLabel: (n: number) => `${n} תמונות דומות - פתיחה להשוואה ובחירת הטובה ביותר`,
  chooserTitle: (n: number) => `${n} תמונות דומות`,
  chooserHint: 'צולמו ברצף - איזו הכי טובה?',
  pickBest: '✓ זו הכי טובה',
  picked: '✓ נבחרה',
  photo: (n: number) => `תמונה ${n}`,
  close: 'סגירה',
} as const;

export interface NavBarPhoto {
  id: string;
  chapterId?: string | null;
  burstId?: string | null;
}

interface GalleryNavBarProps {
  chapters: Chapter[];
  // כל התמונות (לא המסוננות) - לספירות ולהתקדמות
  photos: NavBarPhoto[];
  chapterFilter: string;
  onChapterFilter: (key: string) => void;
  viewedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  hasBursts: boolean;
  hideSimilar: boolean;
  onHideSimilar: (value: boolean) => void;
  accent: string;
}

export default function GalleryNavBar({
  chapters,
  photos,
  chapterFilter,
  onChapterFilter,
  viewedIds,
  isSelected,
  hasBursts,
  hideSimilar,
  onHideSimilar,
  accent,
}: GalleryNavBarProps) {
  const progress = chapterProgress(chapters, photos, viewedIds, isSelected);
  const showChapters = progress.length > 0;
  if (!showChapters && !hasBursts) return null;

  const withoutChapter = showChapters ? photos.filter((p) => !p.chapterId).length : 0;

  const chipStyle = (active: boolean) => ({
    ...outlineButtonStyle,
    padding: '0.3rem 0.85rem',
    fontSize: 12,
    borderRadius: 999,
    whiteSpace: 'nowrap' as const,
    borderColor: active ? accent : theme.border,
    color: active ? accent : theme.textMuted,
    background: active ? `${accent}22` : 'transparent',
  });

  return (
    <div style={{ padding: '0 1.5rem 0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      {showChapters && (
        <div
          role="group"
          aria-label={S.chaptersLabel}
          style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', maxWidth: '100%', paddingBottom: 2, scrollbarWidth: 'thin' }}
        >
          <button aria-pressed={chapterFilter === 'all'} onClick={() => onChapterFilter('all')} style={chipStyle(chapterFilter === 'all')}>
            {S.all}
          </button>
          {progress.map((c) => (
            <button
              key={c.id}
              aria-pressed={chapterFilter === c.id}
              onClick={() => onChapterFilter(c.id)}
              title={S.progress(c.viewed, c.total, c.selected)}
              style={chipStyle(chapterFilter === c.id)}
            >
              {c.name} (<bdi dir="ltr">{c.total}</bdi>)
              {c.done && (
                <span role="img" aria-label={S.viewedAll} style={{ marginInlineStart: 4, color: theme.successText }}>
                  ✓
                </span>
              )}
              {!c.done && c.viewed > 0 && (
                // פס התקדמות זעיר בתוך הצ'יפ - כמה מהפרק כבר נצפה
                <span
                  aria-hidden="true"
                  style={{ display: 'inline-block', width: 28, height: 3, borderRadius: 2, background: theme.border, marginInlineStart: 6, verticalAlign: 'middle', overflow: 'hidden' }}
                >
                  <span style={{ display: 'block', height: '100%', width: `${Math.round((c.viewed / c.total) * 100)}%`, background: accent }} />
                </span>
              )}
              {c.selected > 0 && <span style={{ marginInlineStart: 4, fontSize: 11 }}>♥{c.selected}</span>}
            </button>
          ))}
          {withoutChapter > 0 && (
            <button aria-pressed={chapterFilter === NO_CHAPTER} onClick={() => onChapterFilter(NO_CHAPTER)} style={chipStyle(chapterFilter === NO_CHAPTER)}>
              {S.noChapter} (<bdi dir="ltr">{withoutChapter}</bdi>)
            </button>
          )}
        </div>
      )}

      {hasBursts && (
        <label title={S.hideSimilarHint} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, color: theme.textMuted, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideSimilar} onChange={(e) => onHideSimilar(e.target.checked)} />
          {S.hideSimilar}
        </label>
      )}
    </div>
  );
}

// התג על כרטיס בגריד - כפתור קטן בפינה התחתונה, מעל התמונה.
export function BurstBadge({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count < 2) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={S.similarBadgeLabel(count)}
      title={S.similarBadgeLabel(count)}
      style={{
        position: 'absolute', bottom: 34, left: 8, zIndex: 1, cursor: 'pointer',
        background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, lineHeight: 1.4,
        padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.35)', whiteSpace: 'nowrap',
      }}
    >
      {S.similarBadge(count)}
    </button>
  );
}

export interface ChooserPhoto {
  id: string;
  thumbnailUrl: string | null;
  fullUrl: string | null;
}

interface BurstChooserProps {
  photos: ChooserPhoto[];
  photoNumberById: Map<string, number>;
  isSelected: (id: string) => boolean;
  // null = אי אפשר לבחור (נעול / צפייה בלבד / משתתפת לא מזוהה)
  onPick: ((id: string) => void) | null;
  onClose: () => void;
  accent: string;
  accentText: string;
}

// חלון "תמונות דומות" - כל הרצף זה לצד זה (גלילה אופקית בנייד).
export function BurstChooser({ photos, photoNumberById, isSelected, onPick, onClose, accent, accentText }: BurstChooserProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (photos.length === 0) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={S.chooserTitle(photos.length)}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 55,
        display: 'flex', flexDirection: 'column', padding: '1rem', gap: '0.75rem', outline: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div>
          <div style={{ fontFamily: theme.fontSerif, fontSize: 18 }}>{S.chooserTitle(photos.length)}</div>
          {onPick && <div style={{ fontSize: 12, opacity: 0.7 }}>{S.chooserHint}</div>}
        </div>
        <button
          onClick={onClose}
          aria-label={S.close}
          title={S.close}
          style={{
            width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
            background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 18, cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 0, display: 'flex', gap: '0.75rem', overflowX: 'auto', alignItems: 'center', scrollSnapType: 'x mandatory' }}
      >
        {photos.map((photo) => {
          const selected = isSelected(photo.id);
          const src = photo.fullUrl ?? photo.thumbnailUrl;
          return (
            <div
              key={photo.id}
              style={{
                flex: `0 0 ${photos.length === 2 ? 'calc(50% - 0.4rem)' : 'min(80vw, 420px)'}`, scrollSnapAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', maxHeight: '100%',
              }}
            >
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    maxWidth: '100%', maxHeight: '68vh', objectFit: 'contain', borderRadius: 6,
                    border: `3px solid ${selected ? accent : 'transparent'}`,
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  }}
                />
              )}
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{S.photo(photoNumberById.get(photo.id) ?? 0)}</div>
              {onPick &&
                (selected ? (
                  <span style={{ color: accent, fontWeight: 'bold', fontSize: 14 }}>{S.picked}</span>
                ) : (
                  <button
                    onClick={() => onPick(photo.id)}
                    style={{
                      background: accent, color: accentText, border: 'none', borderRadius: 4,
                      padding: '0.55rem 1.25rem', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                    }}
                  >
                    {S.pickBest}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
