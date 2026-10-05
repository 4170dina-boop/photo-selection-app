// "בוחרים ביחד" - לוגיקה טהורה (בלי React/fetch) לסינונים המשותפים בגלריה
// (app/gallery/[id]/page.tsx): "כולם בחרו", "רק <שם>", "רק אני", וגם
// מיזוג הסימונים של האחרים שמגיעים מהסקר החי (app/api/gallery/[id]/marks)
// וזיהוי "מה חדש" בשביל ההודעה הקופצת.
//
// הגדרות (רק סטטוס 'selected' נחשב "בחרו" - 'אולי' הוא לא בחירה):
// - משתתפים פעילים: כל מי שסימן/ה משהו (נבחר או אולי) בגלריה, כולל אני.
// - "כולם בחרו": תמונה שאני בחרתי, וגם כל שאר המשתתפים הפעילים בחרו בה.
//   (עם שני משתתפים זה בדיוק "אני + עוד אחד/ת"; עם שלושה ומעלה זה באמת
//   "כולם", כמו שהתווית אומרת - בלי הפתעות.)
// - "רק <שם>": תמונות ש<שם> בחר/ה ואני לא בחרתי (גם אם סימנתי "אולי") -
//   ההצעות שלו/ה שעוד לא אימצתי.
// - "רק אני": תמונות שאני בחרתי ואף אחד/ת אחר/ת לא בחר/ה.

export type MarkStatus = 'maybe' | 'selected';

export interface ParticipantMark {
  participantId: string;
  displayName: string;
  status: string;
}

export type AllMarks = Record<string, ParticipantMark[]>;

export interface TogetherFilters {
  // האם להציג בכלל את הסינונים המשותפים (לפחות 2 משתתפים עם סימונים)
  show: boolean;
  everyone: string[];
  onlyMe: string[];
  onlyOthers: { participantId: string; displayName: string; photoIds: string[] }[];
}

export type TogetherFilterKey = 'together' | 'onlyMe' | `only:${string}`;

export function onlyParticipantKey(participantId: string): TogetherFilterKey {
  return `only:${participantId}`;
}

// photoIds - סדר התמונות בגריד (כך גם הרשימות שמוחזרות שומרות על הסדר).
// myStatuses - הסימונים שלי כפי שמוצגים כרגע (כולל אופטימיים/תור אופליין),
// ולא הגרסה שלי מתוך allMarks, שעשויה להיות ישנה יותר.
export function computeTogetherFilters(
  photoIds: string[],
  myId: string | null | undefined,
  myStatuses: Record<string, string | undefined>,
  allMarks: AllMarks
): TogetherFilters {
  // others: participantId -> (photoId -> status), רק של האחרים
  const others = new Map<string, { displayName: string; statuses: Map<string, string> }>();
  for (const photoId of photoIds) {
    for (const m of allMarks[photoId] ?? []) {
      if (!m || m.participantId === myId) continue;
      let entry = others.get(m.participantId);
      if (!entry) {
        entry = { displayName: m.displayName, statuses: new Map() };
        others.set(m.participantId, entry);
      }
      entry.statuses.set(photoId, m.status);
    }
  }

  const iHaveMarks = photoIds.some((id) => !!myStatuses[id]);
  const activeCount = others.size + (iHaveMarks ? 1 : 0);

  const everyone: string[] = [];
  const onlyMe: string[] = [];
  for (const photoId of photoIds) {
    if (myStatuses[photoId] !== 'selected') continue;
    let anyOther = false;
    let allOthers = others.size > 0;
    others.forEach((o) => {
      if (o.statuses.get(photoId) === 'selected') anyOther = true;
      else allOthers = false;
    });
    if (allOthers) everyone.push(photoId);
    if (!anyOther) onlyMe.push(photoId);
  }

  const onlyOthers = Array.from(others.entries()).map(([participantId, o]) => ({
    participantId,
    displayName: o.displayName,
    photoIds: photoIds.filter((id) => o.statuses.get(id) === 'selected' && myStatuses[id] !== 'selected'),
  }));

  return { show: activeCount >= 2, everyone, onlyMe, onlyOthers };
}

// מחזיר את רשימת התמונות של סינון משותף, או null אם המפתח לא מוכר
// (למשל משתתף/ת שכבר לא ברשימה) - ואז הקורא חוזר ל"הכל".
export function photoIdsForTogetherFilter(filters: TogetherFilters, key: string): string[] | null {
  if (key === 'together') return filters.everyone;
  if (key === 'onlyMe') return filters.onlyMe;
  if (key.startsWith('only:')) {
    const pid = key.slice('only:'.length);
    return filters.onlyOthers.find((o) => o.participantId === pid)?.photoIds ?? null;
  }
  return null;
}

// מיזוג תשובת הסקר החי: הסימונים של האחרים - מהשרת; הסימונים שלי - תמיד
// מהמצב המקומי, כדי לא לדרוס סימון אופטימי שעוד בדרך או שממתין בתור האופליין.
export function mergeOthersMarks(local: AllMarks, server: AllMarks, myId: string | null | undefined): AllMarks {
  const result: AllMarks = {};
  const ids = new Set([...Object.keys(local), ...Object.keys(server)]);
  ids.forEach((photoId) => {
    const others = (server[photoId] ?? []).filter((m) => m.participantId !== myId);
    const mine = (local[photoId] ?? []).filter((m) => m.participantId === myId);
    const merged = [...others, ...mine];
    if (merged.length > 0) result[photoId] = merged;
  });
  return result;
}

// מי מהאחרים סימן/ה משהו חדש מאז הסקר הקודם: תמונה שלא הייתה מסומנת אצלו/ה,
// או שהסטטוס שלה השתנה (למשל אולי -> נבחר). ביטול סימון לא נחשב "חדש".
export function newMarksByOthers(
  prev: AllMarks,
  next: AllMarks,
  myId: string | null | undefined
): { participantId: string; displayName: string; count: number }[] {
  const prevStatus = new Map<string, string>();
  Object.entries(prev).forEach(([photoId, marks]) => {
    (marks ?? []).forEach((m) => prevStatus.set(`${m.participantId}|${photoId}`, m.status));
  });

  const counts = new Map<string, { displayName: string; count: number }>();
  Object.entries(next).forEach(([photoId, marks]) => {
    (marks ?? []).forEach((m) => {
      if (m.participantId === myId) return;
      if (prevStatus.get(`${m.participantId}|${photoId}`) === m.status) return;
      const entry = counts.get(m.participantId) ?? { displayName: m.displayName, count: 0 };
      entry.count += 1;
      counts.set(m.participantId, entry);
    });
  });
  return Array.from(counts.entries()).map(([participantId, v]) => ({ participantId, ...v }));
}

// טקסט ההודעה הקופצת. "סימן/ה" - השם יכול להיות של גבר או של אישה.
export function newMarksToastText(items: { displayName: string; count: number }[]): string | null {
  if (items.length === 0) return null;
  const parts = items.map((i) => `${i.displayName} סימן/ה ${i.count === 1 ? 'תמונה חדשה' : `${i.count} תמונות חדשות`}`);
  return `🔔 ${parts.join(' · ')}`;
}

// מרווח הסקר החי: 20 שניות כרגיל, ובכל כשל רצוף מכפילים (עד 5 דקות).
export const MARKS_POLL_MS = 20_000;
const MARKS_POLL_MAX_MS = 5 * 60_000;

export function marksPollDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return MARKS_POLL_MS;
  return Math.min(MARKS_POLL_MAX_MS, MARKS_POLL_MS * 2 ** Math.min(consecutiveFailures, 10));
}

// שמות האחרים שבחרו (סטטוס 'selected') בתמונה מסוימת - לשורה "גם X בחרו"
// בתצוגה המוגדלת.
export function othersWhoSelected(marks: ParticipantMark[] | undefined, myId: string | null | undefined): string[] {
  return (marks ?? []).filter((m) => m.participantId !== myId && m.status === 'selected').map((m) => m.displayName);
}

// בונה allMarks בצד השרת מתוך שורות selections + gallery_participants -
// אותה צורה כמו ב-app/api/gallery/[id]/route.ts. סימונים של משתתף/ת שלא
// ברשימה (נמחק/ה) מושמטים.
export function buildAllMarks(
  selections: { photo_id: string; participant_id: string; status: string }[],
  participants: { id: string; displayName: string }[]
): AllMarks {
  const names = new Map(participants.map((p) => [p.id, p.displayName]));
  const result: AllMarks = {};
  selections.forEach((s) => {
    const displayName = names.get(s.participant_id);
    if (displayName === undefined) return;
    if (!result[s.photo_id]) result[s.photo_id] = [];
    result[s.photo_id].push({ participantId: s.participant_id, displayName, status: s.status });
  });
  return result;
}
