// "שמירה" אופטימית לעדכון מותנה: UPDATE ... WHERE <עמודה> = <הערך שקראנו>
// לכל עמודה ב-guard, כך שהעדכון חל רק אם השורה עדיין במצב שעליו התקבלה
// ההחלטה. null הופך ל-IS NULL (ב-SQL, `= null` אף פעם לא מתקיים).
// אחרי העדכון בודקים כמה שורות חזרו (.select) - 0 = מישהו שינה את השורה בינתיים.
// ב-Postgres (READ COMMITTED) תנאי ה-WHERE של UPDATE נבדק מחדש אחרי נעילת
// השורה, כך ששני עדכונים מותנים מתחרים לא יכולים להצליח שניהם על בסיס אותו מצב.

export type RowGuard = Record<string, string | null>;

export interface GuardableQuery<Q> {
  eq(column: string, value: string): Q;
  is(column: string, value: null): Q;
}

export function applyRowGuard<Q extends GuardableQuery<Q>>(query: Q, guard: RowGuard): Q {
  let q = query;
  for (const [column, value] of Object.entries(guard)) {
    q = value === null ? q.is(column, null) : q.eq(column, value);
  }
  return q;
}
