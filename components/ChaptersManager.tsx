'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { theme, goldButtonStyle, inputStyle, outlineButtonStyle } from '@/lib/theme';
import {
  CHAPTER_NAME_MAX_LENGTH,
  DEFAULT_SPLIT_GAP_MINUTES,
  NO_CHAPTER,
  defaultSplitName,
  filterByChapter,
  orderForTimeline,
  proposeTimeSplits,
  sortChapters,
  splitEvenly,
  type Chapter,
} from '@/lib/chapters';

// ניהול "פרקים" בדף ההעלאה/הסקירה של הצלמת (app/dashboard/upload/[galleryId]):
// יצירה / שינוי שם / סידור / מחיקה של פרקים, שיוך תמונות נבחרות לפרק
// ("העברה לפרק…"), וחלוקה אוטומטית לפי הפסקות בשעת הצילום. הלקוחה רואה את
// הפרקים כשורת צ'יפים מעל הגריד (components/GalleryNavBar.tsx).
// ה-API: app/api/galleries/[id]/chapters (+ /[chapterId], /assign).

// TODO i18n - להעביר ל-lib/i18n כשהוא יגיע ל-main
const S = {
  title: '📑 פרקים',
  intro: 'חלוקת הגלריה לחלקים עם שם ("💍 חופה", "💃 ריקודים") - הלקוחה תראה אותם כצ\'יפים מעל הגריד, עם התקדמות לכל פרק.',
  missingSchema: 'כדי להשתמש בפרקים צריך להריץ פעם אחת את המיגרציה "פרקים, שעת צילום ותמונות דומות" בסוף supabase/schema.sql.',
  newPlaceholder: 'שם פרק חדש',
  add: 'הוספה',
  suggestions: ['💍 חופה', '💃 ריקודים', '👨‍👩‍👧 משפחה', '📸 צילומי זוג', '🥂 קבלת פנים'],
  noChapters: 'עוד אין פרקים.',
  rename: 'שינוי שם',
  save: 'שמירה',
  cancel: 'ביטול',
  remove: 'מחיקה',
  confirmRemove: (name: string) => `למחוק את הפרק "${name}"? התמונות עצמן נשארות בגלריה, רק בלי שיוך לפרק.`,
  moveUp: 'הזזה למעלה',
  moveDown: 'הזזה למטה',
  photosCount: (n: number) => `${n} תמונות`,
  show: 'הצגה:',
  all: 'הכל',
  noChapter: 'בלי פרק',
  selected: (n: number) => `נבחרו ${n}`,
  selectVisible: 'בחירת כל המוצגות',
  clearSelection: 'ניקוי בחירה',
  moveTo: 'העברה לפרק…',
  removeFromChapter: 'הוצאה מהפרק (בלי פרק)',
  selectHint: 'לחיצה על תמונה בוחרת אותה; Shift+לחיצה בוחרת טווח.',
  autoTitle: '⏱ חלוקה אוטומטית לפי שעת צילום',
  gapLabel: 'פיצול בהפסקה של יותר מ-',
  minutes: 'דקות',
  propose: 'הצעת חלוקה',
  noCaptureTime: 'לרוב התמונות אין שעת צילום שמורה (למשל תמונות שהועלו לפני שהתחלנו לקרוא אותה) - אפשר לחלק לפי סדר ההעלאה לחלקים שווים:',
  parts: 'חלקים',
  proposal: (n: number) => `הצעה: ${n} פרקים`,
  replaceExisting: 'להחליף את הפרקים הקיימים',
  createChapters: 'יצירת הפרקים',
  creating: 'יוצרת...',
  close: 'סגירה',
  error: 'הפעולה נכשלה, נסי שוב',
} as const;

export interface ChaptersManagerPhoto {
  id: string;
  thumbnailUrl: string | null;
  chapterId?: string | null;
  takenAt?: string | null;
}

interface ChaptersManagerProps {
  galleryId: string;
  // בסדר ההעלאה (כמו שהסקירה מחזירה)
  photos: ChaptersManagerPhoto[];
  // false = המיגרציה לא רצה (navAvailable מ-/review)
  available: boolean;
  // אחרי שיוך/מחיקה - טעינה מחדש של התמונות (chapterId עדכני)
  onPhotosChanged: () => void;
}

interface ProposalItem {
  name: string;
  photoIds: string[];
}

export default function ChaptersManager({ galleryId, photos, available, onPhotosChanged }: ChaptersManagerProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [schemaMissing, setSchemaMissing] = useState(!available);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClickedRef = useRef<string | null>(null);
  const [gapMinutes, setGapMinutes] = useState(DEFAULT_SPLIT_GAP_MINUTES);
  const [evenParts, setEvenParts] = useState(3);
  const [proposal, setProposal] = useState<ProposalItem[] | null>(null);
  const [proposalUsesTime, setProposalUsesTime] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);

  useEffect(() => {
    setSchemaMissing(!available);
    if (!available) return;
    loadChapters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, available]);

  async function loadChapters() {
    const res = await fetch(`/api/galleries/${galleryId}/chapters`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    if (!data) return;
    setSchemaMissing(!data.available);
    setChapters(sortChapters(data.chapters ?? []));
  }

  // עטיפה משותפת לכל פעולה מול השרת: busy + שגיאה + טעינה מחדש
  async function run(action: () => Promise<Response>, options: { reloadPhotos?: boolean } = {}): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const res = await action();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.missingSchema) setSchemaMissing(true);
        setError(data.error ?? S.error);
        return false;
      }
      await loadChapters();
      if (options.reloadPhotos) onPhotosChanged();
      return true;
    } catch {
      setError(S.error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const countByChapter = useMemo(() => {
    const map = new Map<string, number>();
    photos.forEach((p) => p.chapterId && map.set(p.chapterId, (map.get(p.chapterId) ?? 0) + 1));
    return map;
  }, [photos]);
  const noChapterCount = photos.filter((p) => !p.chapterId).length;
  const visible = filterByChapter(photos, filter);

  async function addChapter(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await run(() =>
      fetch(`/api/galleries/${galleryId}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
    );
    if (ok) setNewName('');
  }

  async function saveRename(id: string) {
    const ok = await run(() =>
      fetch(`/api/galleries/${galleryId}/chapters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameDraft }),
      })
    );
    if (ok) setRenamingId(null);
  }

  async function removeChapter(chapter: Chapter) {
    if (!window.confirm(S.confirmRemove(chapter.name))) return;
    if (filter === chapter.id) setFilter('all');
    await run(() => fetch(`/api/galleries/${galleryId}/chapters/${chapter.id}`, { method: 'DELETE' }), { reloadPhotos: true });
  }

  // החלפת מקום עם השכן - מנרמלים את כל ה-sort ל-1..n כדי שגם ערכים כפולים
  // (למשל אחרי יצירה מקבילה) יסתדרו.
  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= chapters.length) return;
    const reordered = [...chapters];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const changes = reordered
      .map((c, i) => ({ id: c.id, sort: i + 1, prev: c.sort }))
      .filter((c) => c.sort !== c.prev);
    setChapters(reordered.map((c, i) => ({ ...c, sort: i + 1 })));
    await run(async () => {
      let last: Response | null = null;
      for (const c of changes) {
        last = await fetch(`/api/galleries/${galleryId}/chapters/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort: c.sort }),
        });
        if (!last.ok) return last;
      }
      return last ?? new Response('{}');
    });
  }

  function togglePhoto(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const last = lastClickedRef.current;
      if (shiftKey && last) {
        const ids = visible.map((p) => p.id);
        const a = ids.indexOf(last);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [from, to] = a < b ? [a, b] : [b, a];
          ids.slice(from, to + 1).forEach((x) => next.add(x));
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedRef.current = id;
  }

  async function moveSelectedTo(value: string) {
    if (!value || selected.size === 0) return;
    const chapterId = value === NO_CHAPTER ? null : value;
    const ok = await run(
      () =>
        fetch(`/api/galleries/${galleryId}/chapters/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoIds: Array.from(selected), chapterId }),
        }),
      { reloadPhotos: true }
    );
    if (ok) setSelected(new Set());
  }

  function proposeByTime() {
    const result = proposeTimeSplits(
      photos.map((p) => ({ id: p.id, takenAt: p.takenAt ?? null })),
      gapMinutes
    );
    setProposalUsesTime(result.usedCaptureTime);
    if (!result.usedCaptureTime) {
      proposeEvenly(evenParts);
      return;
    }
    setProposal(result.splits.map((s, i) => ({ name: defaultSplitName(i, s), photoIds: s.photoIds })));
  }

  function proposeEvenly(parts: number) {
    const ordered = orderForTimeline(photos.map((p) => ({ id: p.id, takenAt: p.takenAt ?? null }))).ordered.map((o) => o.photo.id);
    setProposal(splitEvenly(ordered, parts).map((ids, i) => ({ name: defaultSplitName(i, { startAt: null, endAt: null }), photoIds: ids })));
  }

  async function createFromProposal() {
    if (!proposal || proposal.length === 0) return;
    const ok = await run(
      () =>
        fetch(`/api/galleries/${galleryId}/chapters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapters: proposal.map((p) => ({ name: p.name.trim() || 'חלק', photoIds: p.photoIds })),
            replace: replaceExisting,
          }),
        }),
      { reloadPhotos: true }
    );
    if (ok) setProposal(null);
  }

  const thumbById = useMemo(() => new Map(photos.map((p) => [p.id, p.thumbnailUrl])), [photos]);

  const sectionStyle = { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '1rem', marginBottom: '2rem' };
  const smallButton = { ...outlineButtonStyle, padding: '0.3rem 0.7rem', fontSize: 12 };

  if (photos.length === 0) return null;

  return (
    <details style={sectionStyle}>
      <summary style={{ cursor: 'pointer', fontFamily: theme.fontSerif, fontSize: 16 }}>
        {S.title}
        {chapters.length > 0 && <span style={{ color: theme.textFaint, fontSize: 12 }}> ({chapters.length})</span>}
      </summary>

      <p style={{ color: theme.textFaint, fontSize: 12, margin: '0.5rem 0 0.75rem' }}>{S.intro}</p>

      {schemaMissing ? (
        <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: 13 }}>
          {S.missingSchema}
        </p>
      ) : (
        <>
          {error && <p role="alert" style={{ color: theme.errorText, fontSize: 12, marginBottom: '0.5rem' }}>{error}</p>}

          {/* רשימת הפרקים */}
          {chapters.length === 0 ? (
            <p style={{ color: theme.textMuted, fontSize: 13 }}>{S.noChapters}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {chapters.map((c, i) => (
                <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {renamingId === c.id ? (
                    <>
                      <input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        maxLength={CHAPTER_NAME_MAX_LENGTH}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename(c.id)}
                        autoFocus
                        style={{ ...inputStyle, padding: '0.35rem 0.6rem', fontSize: 14 }}
                      />
                      <button onClick={() => saveRename(c.id)} disabled={busy} style={smallButton}>{S.save}</button>
                      <button onClick={() => setRenamingId(null)} style={smallButton}>{S.cancel}</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 14, minWidth: 120 }}>{c.name}</span>
                      <span style={{ color: theme.textFaint, fontSize: 12 }}>{S.photosCount(countByChapter.get(c.id) ?? 0)}</span>
                      <button onClick={() => move(i, -1)} disabled={busy || i === 0} title={S.moveUp} aria-label={S.moveUp} style={smallButton}>↑</button>
                      <button onClick={() => move(i, 1)} disabled={busy || i === chapters.length - 1} title={S.moveDown} aria-label={S.moveDown} style={smallButton}>↓</button>
                      <button onClick={() => { setRenamingId(c.id); setRenameDraft(c.name); }} style={smallButton}>{S.rename}</button>
                      <button onClick={() => removeChapter(c)} disabled={busy} style={{ ...smallButton, color: theme.errorText }}>{S.remove}</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* פרק חדש */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addChapter(newName)}
              maxLength={CHAPTER_NAME_MAX_LENGTH}
              placeholder={S.newPlaceholder}
              style={{ ...inputStyle, padding: '0.4rem 0.7rem', fontSize: 14, flex: '1 1 180px' }}
            />
            <button onClick={() => addChapter(newName)} disabled={busy || !newName.trim()} style={{ ...goldButtonStyle, padding: '0.45rem 1rem' }}>
              {S.add}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {S.suggestions
              .filter((s) => !chapters.some((c) => c.name === s))
              .map((s) => (
                <button key={s} onClick={() => addChapter(s)} disabled={busy} style={{ ...smallButton, borderRadius: 999 }}>
                  + {s}
                </button>
              ))}
          </div>

          {/* חלוקה אוטומטית */}
          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: 14, marginBottom: '0.5rem' }}>{S.autoTitle}</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: theme.textMuted }}>
              <label htmlFor="chapter-gap">{S.gapLabel}</label>
              <input
                id="chapter-gap"
                type="number"
                min={1}
                max={600}
                value={gapMinutes}
                onChange={(e) => setGapMinutes(Math.max(1, Number(e.target.value) || DEFAULT_SPLIT_GAP_MINUTES))}
                style={{ ...inputStyle, width: 80, padding: '0.3rem 0.5rem', fontSize: 14 }}
              />
              <span>{S.minutes}</span>
              <button onClick={proposeByTime} disabled={busy} style={smallButton}>{S.propose}</button>
            </div>

            {proposal && (
              <div style={{ marginTop: '0.75rem', background: theme.panelInput, borderRadius: 8, padding: '0.75rem' }}>
                {!proposalUsesTime && (
                  <div style={{ fontSize: 12, color: theme.warningText, marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{S.noCaptureTime}</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={evenParts}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                        setEvenParts(n);
                        proposeEvenly(n);
                      }}
                      style={{ ...inputStyle, width: 70, padding: '0.25rem 0.5rem', fontSize: 14 }}
                    />
                    <span>{S.parts}</span>
                  </div>
                )}
                <div style={{ fontSize: 13, marginBottom: '0.5rem' }}>{S.proposal(proposal.length)}</div>
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {proposal.map((item, i) => (
                    <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={item.name}
                        maxLength={CHAPTER_NAME_MAX_LENGTH}
                        onChange={(e) =>
                          setProposal((prev) => (prev ?? []).map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))
                        }
                        style={{ ...inputStyle, padding: '0.3rem 0.6rem', fontSize: 14, flex: '1 1 160px' }}
                      />
                      <span style={{ color: theme.textFaint, fontSize: 12 }}>{S.photosCount(item.photoIds.length)}</span>
                      {/* תצוגה מקדימה זעירה: 4 תמונות ראשונות */}
                      <span style={{ display: 'flex', gap: 2 }}>
                        {item.photoIds.slice(0, 4).map((id) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={id} src={thumbById.get(id) ?? ''} alt="" loading="lazy" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3 }} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ol>
                {chapters.length > 0 && (
                  <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: 12, color: theme.textMuted, marginTop: '0.6rem' }}>
                    <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                    {S.replaceExisting}
                  </label>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                  <button onClick={createFromProposal} disabled={busy} style={{ ...goldButtonStyle, padding: '0.45rem 1rem', opacity: busy ? 0.6 : 1 }}>
                    {busy ? S.creating : S.createChapters}
                  </button>
                  <button onClick={() => setProposal(null)} style={smallButton}>{S.close}</button>
                </div>
              </div>
            )}
          </div>

          {/* שיוך תמונות */}
          <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', fontSize: 12 }}>
              <span style={{ color: theme.textMuted }}>{S.show}</span>
              {[
                { key: 'all', label: `${S.all} (${photos.length})` },
                ...chapters.map((c) => ({ key: c.id, label: `${c.name} (${countByChapter.get(c.id) ?? 0})` })),
                { key: NO_CHAPTER, label: `${S.noChapter} (${noChapterCount})` },
              ].map((f) => (
                <button
                  key={f.key}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    ...smallButton, borderRadius: 999,
                    borderColor: filter === f.key ? theme.gold : theme.border,
                    color: filter === f.key ? theme.gold : theme.textMuted,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', fontSize: 13 }}>
              <span>{S.selected(selected.size)}</span>
              <button onClick={() => setSelected(new Set(visible.map((p) => p.id)))} style={smallButton}>{S.selectVisible}</button>
              {selected.size > 0 && <button onClick={() => setSelected(new Set())} style={smallButton}>{S.clearSelection}</button>}
              <select
                value=""
                disabled={busy || selected.size === 0}
                onChange={(e) => moveSelectedTo(e.target.value)}
                style={{ ...inputStyle, padding: '0.3rem 0.5rem', fontSize: 14 }}
                aria-label={S.moveTo}
              >
                <option value="">{S.moveTo}</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value={NO_CHAPTER}>{S.removeFromChapter}</option>
              </select>
            </div>
            <p style={{ color: theme.textFaint, fontSize: 11, marginBottom: '0.5rem' }}>{S.selectHint}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
              {visible.map((p) => {
                const isSel = selected.has(p.id);
                const chapterName = p.chapterId ? chapters.find((c) => c.id === p.chapterId)?.name : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={isSel}
                    title={chapterName ?? S.noChapter}
                    onClick={(e) => togglePhoto(p.id, e.shiftKey)}
                    style={{
                      position: 'relative', padding: 0, border: `2px solid ${isSel ? theme.gold : 'transparent'}`,
                      borderRadius: 4, overflow: 'hidden', background: theme.panelInput, cursor: 'pointer',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbnailUrl ?? ''} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', opacity: isSel ? 0.75 : 1 }} />
                    {isSel && (
                      <span aria-hidden="true" style={{ position: 'absolute', top: 2, right: 2, background: theme.gold, color: theme.goldText, borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </details>
  );
}
