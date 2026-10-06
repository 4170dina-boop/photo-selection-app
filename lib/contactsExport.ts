// ייצוא אנשי קשר (app/api/galleries/export-contacts) - לוגיקה טהורה.
// שורה אחת לכל לקוחה (clients), לא לכל גלריה: קודם הייצוא נבנה מ-galleries,
// אז לקוחה עם כמה גלריות הופיעה כמה פעמים, ולקוחה בלי גלריה (למשל שנוצרה
// מיומן הצילומים) לא הופיעה בכלל. פרטי הגלריות מצטרפים כסיכום: כמה גלריות,
// ותאריך/סטטוס/תוקף של האחרונה.

export interface ContactClient {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string | null;
}

export interface ContactGallery {
  client_id: string;
  status: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export interface ContactRow {
  client: ContactClient;
  galleryCount: number;
  lastGallery: ContactGallery | null;
}

function timeOf(value: string | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

export function buildContactRows(clients: ContactClient[], galleries: ContactGallery[]): ContactRow[] {
  const byClient = new Map<string, ContactRow>();
  for (const client of clients) {
    if (!byClient.has(client.id)) byClient.set(client.id, { client, galleryCount: 0, lastGallery: null });
  }
  for (const gallery of galleries) {
    const row = byClient.get(gallery.client_id);
    if (!row) continue; // לקוחה שלא חזרה בשאילתה (לא אמור לקרות תחת RLS)
    row.galleryCount++;
    if (!row.lastGallery || timeOf(gallery.created_at) > timeOf(row.lastGallery.created_at)) {
      row.lastGallery = gallery;
    }
  }
  // הפעילות האחרונה קודם: לפי הגלריה האחרונה, ובלי גלריה - לפי יצירת הלקוחה
  return Array.from(byClient.values()).sort(
    (a, b) =>
      Math.max(timeOf(b.lastGallery?.created_at), timeOf(b.client.created_at)) -
        Math.max(timeOf(a.lastGallery?.created_at), timeOf(a.client.created_at)) || a.client.id.localeCompare(b.client.id)
  );
}
