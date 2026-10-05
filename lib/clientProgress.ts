// "מה הבא?" - מעקב התקדמות ללקוחה אחרי שסיימה לבחור (components/ClientProgressTracker.tsx).
// שלושה שלבים: בחרת תמונות -> הצלמת עורכת -> התמונות מוכנות.
//
// לוגיקה טהורה בלבד (בלי DB/רשת), כך שאפשר לייבא גם בדפדפן וגם ב-API
// (app/api/gallery/[id]/progress/route.ts). הקלט הוא רק דגלים בוליאניים -
// התאריכים הפנימיים (editing_started_at וכו') לא נחשפים ללקוחה.

export type ClientProgressStep = 'selected' | 'editing' | 'ready';

export const CLIENT_PROGRESS_STEPS: readonly ClientProgressStep[] = ['selected', 'editing', 'ready'] as const;

export interface ClientProgressInput {
  // galleries.status
  status: string | null | undefined;
  // galleries.reopened_for_selection_at קיים = הצלמת פתחה מחדש לבחירה, כלומר
  // הלקוחה שוב "באמצע הבחירה" ואין מה להציג עדיין
  reopenedForSelection?: boolean;
  // galleries.editing_started_at קיים
  editingStarted: boolean;
  // galleries.delivered_at קיים, או שיש לפחות תמונה סופית אחת (delivered_photos)
  delivered: boolean;
}

export interface ClientProgressState {
  current: ClientProgressStep;
  steps: { key: ClientProgressStep; done: boolean; current: boolean }[];
}

// null = אין מה להציג (הבחירה עוד פתוחה). מסירה גוברת על הכל - גם אם הצלמת
// לא סימנה "בעריכה" לפני כן, או אם הגלריה נפתחה מחדש אחרי שכבר נמסרו תמונות.
export function computeClientProgress(input: ClientProgressInput): ClientProgressState | null {
  let current: ClientProgressStep | null = null;
  if (input.delivered) {
    current = 'ready';
  } else if (input.status === 'completed' && !input.reopenedForSelection) {
    current = input.editingStarted ? 'editing' : 'selected';
  }
  if (!current) return null;

  const currentIndex = CLIENT_PROGRESS_STEPS.indexOf(current);
  return {
    current,
    steps: CLIENT_PROGRESS_STEPS.map((key, i) => ({
      key,
      // השלב האחרון ("מוכנות") הוא גם done וגם current כשהגענו אליו
      done: i < currentIndex || (key === 'ready' && current === 'ready'),
      current: i === currentIndex,
    })),
  };
}
