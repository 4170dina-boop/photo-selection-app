// לוגיקה טהורה (בלי DB/רשת) של דף הלקוחות (app/dashboard/clients/*).
//
// במודל הנוכחי כל גלריה (וכל צילום עם "לקוחה חדשה") יוצרים שורת clients משלהם,
// כך שאותה לקוחה יכולה להופיע בכמה שורות. כאן מאחדים אותן ל"לקוחה לוגית" אחת:
// לפי מייל (בלי רגישות לאותיות גדולות/רווחים), ואם אין מייל - לפי שם.
// אותו כלל כמו הסינון לפי מייל ב-app/api/shoots/options/route.ts.

export interface ClientRowLike {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at?: string | null;
}

export interface ClientGroup {
  key: string;
  // השם והמייל מהשורה האחרונה שנוצרה (הכי עדכניים)
  name: string;
  email: string;
  clientIds: string[];
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

// מפתח הקיבוץ - גם המזהה ב-URL של דף הלקוחה (app/dashboard/clients/[key]).
export function clientGroupKey(row: Pick<ClientRowLike, 'full_name' | 'email'>): string {
  const email = normalizeSpaces(row.email ?? '').toLowerCase();
  if (email) return `email:${email}`;
  return `name:${normalizeSpaces(row.full_name ?? '').toLowerCase()}`;
}

function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export function groupClients(rows: ClientRowLike[]): ClientGroup[] {
  const groups = new Map<string, { group: ClientGroup; latest: number }>();
  for (const row of rows) {
    const key = clientGroupKey(row);
    const created = timeOf(row.created_at);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        group: { key, name: normalizeSpaces(row.full_name ?? ''), email: (row.email ?? '').trim(), clientIds: [row.id] },
        latest: created,
      });
      continue;
    }
    existing.group.clientIds.push(row.id);
    if (created > existing.latest) {
      existing.latest = created;
      existing.group.name = normalizeSpaces(row.full_name ?? '') || existing.group.name;
      existing.group.email = (row.email ?? '').trim() || existing.group.email;
    }
  }
  return [...groups.values()].map((g) => g.group);
}

// התאריך המאוחר ביותר מתוך רשימה (null/לא תקין מדולגים). null = אין כלום.
export function latestTimestamp(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    const t = timeOf(v);
    if (t > bestTime) {
      bestTime = t;
      best = v ?? null;
    }
  }
  return best;
}

export interface GalleryForClient {
  id: string;
  client_id: string;
  created_at: string | null;
  last_activity_at?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  // מתוך computePaymentSummary (lib/payments.ts)
  paid: number;
  outstanding: number;
}

export interface ShootForClient {
  id: string;
  client_id: string;
  shoot_date: string; // YYYY-MM-DD
  created_at?: string | null;
}

export interface ClientSummary extends ClientGroup {
  galleryIds: string[];
  shootIds: string[];
  galleryCount: number;
  shootCount: number;
  lastActivity: string | null;
  totalPaid: number;
  balanceDue: number;
}

// סכימה באגורות שלמות - כמו lib/payments.ts, כדי לא להשאיר שאריות float.
function sumShekels(values: number[]): number {
  return values.reduce((sum, v) => sum + Math.round((Number(v) || 0) * 100), 0) / 100;
}

// todayDate = "YYYY-MM-DD" (זמן ישראל): צילום עתידי לא נחשב "פעילות אחרונה"
// לפי תאריך הצילום (רק לפי מתי נקבע), אחרת לקוחה עם צילום בעוד חודשיים הייתה
// "קופצת" לראש הרשימה כאילו הייתה פעילה מחר.
export function buildClientSummaries(input: {
  clients: ClientRowLike[];
  galleries: GalleryForClient[];
  shoots: ShootForClient[];
  todayDate: string;
}): ClientSummary[] {
  const groups = groupClients(input.clients);
  const groupByClientId = new Map<string, ClientGroup>();
  for (const g of groups) for (const id of g.clientIds) groupByClientId.set(id, g);

  const clientCreated = new Map(input.clients.map((c) => [c.id, c.created_at ?? null]));
  const galleriesByKey = new Map<string, GalleryForClient[]>();
  const shootsByKey = new Map<string, ShootForClient[]>();
  for (const gal of input.galleries) {
    const g = groupByClientId.get(gal.client_id);
    if (!g) continue;
    const list = galleriesByKey.get(g.key) ?? [];
    list.push(gal);
    galleriesByKey.set(g.key, list);
  }
  for (const s of input.shoots) {
    const g = groupByClientId.get(s.client_id);
    if (!g) continue;
    const list = shootsByKey.get(g.key) ?? [];
    list.push(s);
    shootsByKey.set(g.key, list);
  }

  const summaries = groups.map((g): ClientSummary => {
    const gals = galleriesByKey.get(g.key) ?? [];
    const shoots = shootsByKey.get(g.key) ?? [];
    const lastActivity = latestTimestamp([
      ...g.clientIds.map((id) => clientCreated.get(id)),
      ...gals.flatMap((x) => [x.created_at, x.last_activity_at, x.sent_at, x.delivered_at]),
      ...shoots.flatMap((s) => [s.created_at, s.shoot_date <= input.todayDate ? s.shoot_date : null]),
    ]);
    return {
      ...g,
      galleryIds: gals.map((x) => x.id),
      shootIds: shoots.map((s) => s.id),
      galleryCount: gals.length,
      shootCount: shoots.length,
      lastActivity,
      totalPaid: sumShekels(gals.map((x) => x.paid)),
      balanceDue: sumShekels(gals.map((x) => x.outstanding)),
    };
  });

  return sortByLastActivity(summaries);
}

// הפעילות האחרונה קודם; בלי תאריך בסוף; שוויון - לפי שם.
export function sortByLastActivity<T extends { lastActivity: string | null; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = timeOf(b.lastActivity) - timeOf(a.lastActivity);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.name.localeCompare(b.name, 'he');
  });
}

export function filterClients<T extends { name: string; email: string }>(items: T[], query: string): T[] {
  const q = normalizeSpaces(query).toLowerCase();
  if (!q) return items;
  return items.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
}
