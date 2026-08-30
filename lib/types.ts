// טיפוסים בסיסיים התואמים לסכמה שב-supabase/schema.sql

export interface Photographer {
  id: string;
  auth_user_id: string;
  business_name: string;
  logo_url: string | null;
  brand_color: string;
  reminder_days_default: number;
}

export interface Gallery {
  id: string;
  photographer_id: string;
  client_id: string;
  status: 'draft' | 'sent' | 'in_progress' | 'completed' | 'expired';
  reminder_days: number | null;
  sent_at: string | null;
  expires_at: string | null;
}

export interface Photo {
  id: string;
  gallery_id: string;
  // נתיב בתוך ה-bucket הפרטי gallery-photos (לא URL ציבורי) -
  // ה-URL בפועל נוצר כ-signed URL זמני ב-app/api/gallery/[id]/route.ts
  file_path: string;
  thumbnail_path: string | null;
  original_filename: string;
}

export interface Selection {
  id: string;
  gallery_id: string;
  photo_id: string;
  note: string | null;
}
