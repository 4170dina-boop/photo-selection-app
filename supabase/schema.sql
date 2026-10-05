-- סכמת מסד נתונים למערכת בחירת תמונות
-- Multi-tenant מההתחלה: כל רשומה מקושרת (ישירות או בעקיפין) ל-photographer

create extension if not exists "uuid-ossp";

create table photographers (
  id uuid primary key default uuid_generate_v4(),
  -- on delete cascade: מחיקת משתמש ב-Supabase Auth מוחקת גם את שורת הצלמת
  -- (ומשם, ב-cascade, את כל הנתונים שלה) - בלי זה מחיקת המשתמש נכשלה על FK.
  auth_user_id uuid references auth.users(id) on delete cascade unique,
  business_name text not null,
  logo_url text,
  brand_color text default '#000000',
  reminder_days_default int default 5,
  watermark_text text,
  -- ברירות המחדל שממלאות אוטומטית את טופס "גלריה חדשה" (app/dashboard/galleries/new/page.tsx) -
  -- כדי שצלמת עם חבילה קבועה לא תצטרך להקליד את אותם מספרים בכל גלריה.
  -- ניתנות לשינוי בכל גלריה בודדת בנפרד, אלה רק ערכי פתיחה.
  default_included_photos int default 30 not null,
  default_base_price numeric(10,2) default 0 not null,
  default_extra_photo_price numeric(10,2) default 0 not null,
  -- true = פטורה ממגבלות החשבון החינמי (enforce_active_gallery_limit,
  -- enforce_photo_limit למטה) - מסומן ידנית ע"י מנהלת המערכת (ראו
  -- app/dashboard/admin/page.tsx) אחרי שצלמת שילמה על מנוי, לא ניתן להגדרה
  -- עצמית ע"י הצלמת עצמה (ראו protect_is_unlimited בהמשך הקובץ).
  is_unlimited boolean default false not null,
  -- עיצוב מותאם אישית (bg/panel/text/accent) שנוצר ע"י "עיצוב הגלריה עם AI"
  -- בהגדרות (app/api/photographer/design-theme) - null = פלטת ברירת המחדל
  -- הקבועה. theme_gen_count/date הם מונה שימוש יומי (רשת ביטחון על העלות,
  -- ראו README) - מתאפס בכל יום חדש, לא קשור לשום מכסה אחרת באפליקציה.
  custom_theme jsonb,
  theme_gen_count int default 0 not null,
  theme_gen_date date,
  -- מונה שימוש יומי נפרד ל"עזרי לי לבחור" (app/api/gallery/[id]/ai-picks) -
  -- לא אותו מונה כמו theme_gen_count למעלה כי זו קריאת AI יקרה משמעותית
  -- יותר (הרבה תמונות בבת אחת, לא רק טקסט קצר), אז יש לה תקרה יומית נמוכה יותר.
  ai_picks_count int default 0 not null,
  ai_picks_date date,
  -- קישור לביקורת (עמוד "כתיבת ביקורת" בגוגל עסקי, פייסבוק וכו') - מוגדר
  -- פעם אחת בהגדרות, משמש בכפתור "בקשת ביקורת" בעריכת גלריה (זמין רק אחרי
  -- שהגלריה סומנה כ"נמסרה", ראו delivered_at). null = הפיצ'ר לא זמין עדיין.
  review_link text,
  -- יומן צילומים (טבלת shoots למטה): כמה ימים לפני צילום נשלחת ללקוחה תזכורת
  -- אוטומטית (app/api/cron/tick/route.ts). 0 = בלי תזכורת אוטומטית.
  shoot_reminder_days int default 1 not null,
  -- סיכום יומי לצלמת עם הצילומים של מחר (אותו cron). shoot_summary_sent_on =
  -- התאריך (בזמן ישראל) שבו הסיכום האחרון נשלח - כך הוא idempotent ליום גם אם
  -- ה-cron רץ כמה פעמים באותו יום. null = טרם נשלח אף פעם.
  shoot_daily_summary_enabled boolean default true not null,
  shoot_summary_sent_on date,
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default uuid_generate_v4(),
  photographer_id uuid references photographers(id) on delete cascade not null,
  full_name text not null,
  email text not null,
  access_code text unique not null,
  failed_access_attempts int default 0,
  locked_until timestamptz,
  -- מונה נפרד לניסיונות שגויים באימות "זאת אני" (מייל הלקוחה) - ראו
  -- register_failed_owner_claim למטה ו-app/api/gallery/[id]/identify/route.ts
  owner_claim_failed_attempts int default 0,
  owner_claim_locked_until timestamptz,
  created_at timestamptz default now()
);

create table galleries (
  id uuid primary key default uuid_generate_v4(),
  photographer_id uuid references photographers(id) on delete cascade not null,
  client_id uuid references clients(id) on delete cascade not null,
  status text default 'draft' check (status in ('draft', 'sent', 'in_progress', 'completed', 'expired')),
  reminder_days int,
  sent_at timestamptz,
  expires_at timestamptz,
  last_activity_at timestamptz,
  last_reminder_sent_at timestamptz,
  -- ה"בעלים" הרשמי של הגלריה (לשיתוף גלריה משפחתי, ראו gallery_participants
  -- למטה) - נוצר יחד עם הגלריה עצמה, לא null אחרי היצירה. מפנה מראש כדי
  -- שכל שאילתת "כמה נבחרו בפועל" (חיוב, ייצוא, דוחות) תדע בלי חיפוש נוסף
  -- אילו selections הן ה"רשמיות" (של הבעלים) לעומת קלט של בני משפחה אחרים.
  owner_participant_id uuid,
  -- הערות פרטיות של הצלמת על הגלריה/הלקוחה (למשל מיקום הצילום, בקשות מיוחדות) -
  -- לא נחשף בשום API שהלקוחה נגישה אליו (app/api/gallery/[id]/*), רק דרך
  -- app/api/galleries/[id]/route.ts שרץ עם session הצלם.
  photographer_notes text,
  -- כתובות מייל נוספות (למשל בני משפחה) שמקבלות את אותו מייל הזמנה/תזכורת
  -- כמו clients.email - לא זהות נפרדת (לזה יש כבר gallery_participants, כל
  -- מי שנכנס עם הקוד מזהה את עצמו בשם תצוגה), רק רשימת תפוצה לאותו מייל.
  additional_invite_emails text[],
  -- מתי הצלמת התחילה לערוך את התמונות שנבחרו - שלב ביניים נפרד גם מ-status
  -- ('completed' אומר רק שהלקוחה סיימה לבחור) וגם מ-delivered_at (מסירת
  -- הקבצים הסופיים בפועל). null = טרם התחילה עריכה.
  editing_started_at timestamptz,
  -- מתי הצלמת סימנה שהתמונות הסופיות נמסרו בפועל ללקוחה (לא אוטומטי - "הושלם"
  -- רק אומר שהלקוחה סיימה לבחור, לא שהתמונות המוגמרות כבר יצאו). null = טרם נמסר.
  delivered_at timestamptz,
  -- מתי הגלריה סומנה כ"שולמה במלואה" - עצמאי לגמרי מהסטטוס/מסירה (בדרך כלל
  -- משולם בהזמנה, הרבה לפני שהלקוחה סיימה לבחור). אין אינטגרציית סליקה
  -- (ראו README). שתי דרכים לעדכן: הכפתור הידני ברשימת הגלריות
  -- (app/api/galleries/[id]/toggle-paid) כמו תמיד, או אוטומטית בכל הוספה/מחיקה
  -- של תשלום ב-gallery_payments (למטה) - אז הוא נגזר מהיתרה: מסומן כשהתשלומים
  -- מכסים את הסכום לתשלום, ומתבטל כשלא. ראו nextPaidAt ב-lib/payments.ts.
  -- null = טרם שולם.
  paid_at timestamptz,
  -- הסכום הכולל שהלקוחה צריכה לשלם על הגלריה, אם הצלמת דרסה אותו ידנית
  -- (הנחה, תוספת, סכום שסוכם מראש). null = מחושב אוטומטית מהחבילה: base_price
  -- + (תמונות שנבחרו מעבר ל-included_photos) × extra_photo_price - כך שהסכום
  -- מתעדכן לבד כשהלקוחה בוחרת עוד תמונות. ראו computePaymentSummary ב-lib/payments.ts.
  amount_due_override numeric(10,2) check (amount_due_override is null or amount_due_override >= 0),
  -- מתי עבודת הרקע היומית (app/api/cron/tick/route.ts) מחקה את קבצי המקור
  -- (הלא-ערוכים) של הגלריה הזו מ-Storage, כדי לפנות מקום 30 יום אחרי מסירה -
  -- null = עדיין לא נוקתה (או שעדיין לא עברו 30 יום מ-delivered_at). לא
  -- קשור לתמונות הערוכות הסופיות (delivered_photos) - הן אף פעם לא נמחקות אוטומטית.
  originals_cleaned_up_at timestamptz,
  -- מתי נשלחה לצלמת התראה שתמונות המקור עומדות להימחק בקרוב (ראו
  -- sendOriginalsDeletionWarningEmail ב-lib/email.ts) - null = טרם נשלחה.
  -- חד-פעמית, אותו דפוס בדיוק כמו last_reminder_sent_at למעלה.
  originals_deletion_warning_sent_at timestamptz,
  -- מונה צפיות של הלקוחה בגלריה (כל טעינה מוצלחת, לא ייחודי) - כדי שהצלמת
  -- תדע אם הלקוחה בכלל פתחה את הקישור, לא רק שהמייל "נשלח" (יכול להיחסם
  -- אצל הלקוחה בלי שום דרך אחרת לדעת - ראו app/api/gallery/[id]/route.ts).
  view_count int default 0 not null,
  last_viewed_at timestamptz,
  -- מאפשרת לצלמת לפתוח מחדש בחירה ללקוחה אחרי שסימנה "סיימתי לבחור", בלי
  -- להחזיר את status מ-completed לאחור (status נשאר completed, והסיום החוזר
  -- ב-app/api/gallery/[id]/finish מנקה את העמודה). גלריה שנפתחה מחדש נספרת
  -- כפעילה במגבלת החשבון החינמי (trg_enforce_active_gallery_limit למטה) -
  -- אחרת פתיחה מחדש הייתה עוקפת את מגבלת הגלריה הפעילה האחת. וכאן
  -- נסמן שהעריכה מותרת למרות זאת (checkGalleryWritable ב-lib/galleryAccess.ts
  -- בודקת גם אותה). null = נעולה כרגיל, לא-null = פתוחה לבחירה מחדש.
  reopened_for_selection_at timestamptz,
  -- מתי נשלחה לצלמת התראת "הלקוחה הגיעה למכסת החבילה" (sendQuotaReachedEmail,
  -- app/api/gallery/[id]/selection) - null = טרם נשלחה. נתפסת ב-UPDATE מותנה
  -- (is null) כדי שהמייל ייצא פעם אחת בלבד לכל גלריה, גם בבקשות מקבילות.
  quota_notified_at timestamptz,
  -- לשון הפנייה ללקוח/ה הראשי/ת בגלריה ובמיילים (lib/gender.ts): 'f' = נקבה
  -- (ברירת המחדל), 'm' = זכר. נקבע ע"י הצלמת בטופס יצירה/עריכה של הגלריה.
  client_gender text default 'f' not null check (client_gender in ('f', 'm')),
  created_at timestamptz default now()
);

-- שיתוף גלריה משפחתי: כמה בני משפחה נכנסים עם אותו קוד גישה, כל אחד מזוהה
-- בשם משלו (participant), עם בחירות נפרדות - ראו selections.participant_id
-- למטה. is_owner=true היא הלקוחה הרשומה עצמה (galleries.client_id) - נוצרת
-- אוטומטית עם הגלריה; רק היא יכולה לסיים את הבחירה ורק הבחירות שלה נספרות
-- לחיוב/ייצוא. is_owner=false הם אורחים שמצטרפים מאוחר יותר (ראו
-- app/api/gallery/[id]/identify/route.ts) - קלט נוסף לדיון, לא רשמי.
create table gallery_participants (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  display_name text not null,
  is_owner boolean default false not null,
  -- לשון הפנייה לאורח/ת (נבחרת במסך ההצטרפות, app/api/gallery/[id]/identify).
  -- null = לא ידוע (אורחים מלפני השדה) - הגלריה פונה בצורה ניטרלית ("בחר/י").
  -- לבעלים לא בשימוש - שם קובע galleries.client_gender.
  gender text check (gender in ('f', 'm')),
  created_at timestamptz default now()
);

-- רק בעלים אחד לגלריה
create unique index gallery_participants_one_owner_idx on gallery_participants(gallery_id) where is_owner;

alter table galleries add constraint galleries_owner_participant_fk
  foreign key (owner_participant_id) references gallery_participants(id);

create table photos (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  -- נתיב בתוך ה-bucket הפרטי gallery-photos (לא URL ציבורי) - ה-URL בפועל
  -- נוצר כ-signed URL זמני בזמן צפייה, ראו app/api/gallery/[id]/route.ts
  file_path text not null,
  thumbnail_path text,
  original_filename text not null,
  -- variance של Laplacian kernel על התמונה באפור - היוריסטיקת חדות קלאסית,
  -- לא ML. ערך נמוך = כנראה מטושטשת. נחשב פעם אחת בעיבוד (ראו lib/sharpness.ts),
  -- לא בכל בקשה. null עד שהעיבוד רץ, או אם הוא נכשל - לא חוסם שום דבר.
  sharpness_score numeric,
  -- מתי הקובץ הזה הועבר בפועל ל-Cloudflare R2 (מעבר אחסון חד-פעמי, ראו
  -- קוד המיגרציה הוסר מאז) - null = עדיין ב-Supabase Storage
  -- בלבד (או שהמקור כבר נוקה ע"י ניקוי המקור האוטומטי, ראו app/api/cron/tick/route.ts,
  -- ואז אין מה להעביר בפועל, אבל עדיין מסמנים "הועבר" כדי לא לבדוק שוב).
  -- שני עמודות נפרדות (לא עמודה אחת ל"כל הקובץ") כי file_path ו-thumbnail_path
  -- הם שני אובייקטים עצמאיים ב-Storage, שיכולים להימחק/להתקיים בנפרד.
  file_migrated_at timestamptz,
  thumbnail_migrated_at timestamptz,
  -- "תמונת מתנה": בונוס שהצלמת מעניקה ללקוחה (ראו lib/gifts.ts) - כלולה
  -- אוטומטית במסירה ובייצוא, ולא נספרת לא במכסת החבילה (packages.included_photos)
  -- ולא בחיוב על תמונות נוספות. gift_message = הודעה אישית קצרה ללקוחה
  -- (אופציונלית, עד 200 תווים - נאכף גם ב-API). נקבע רק ע"י הצלמת
  -- (app/api/galleries/[id]/photos/[photoId]/gift) - ה-RLS הקיים
  -- "photographers see own photos" כבר מכסה את זה, ללקוחה אין גישה ישירה.
  is_gift boolean default false not null,
  gift_message text check (gift_message is null or char_length(gift_message) <= 200),
  created_at timestamptz default now(),
  -- ה-RLS בודק רק gallery_id, ו-file_path/thumbnail_path נכתבים ע"י הצלמת -
  -- בלי זה אפשר היה להצביע שורה על קובץ של גלריה (או צלמת) אחרת ב-R2.
  constraint photos_paths_in_gallery check (
    starts_with(file_path, gallery_id::text || '/')
    and (thumbnail_path is null or starts_with(thumbnail_path, gallery_id::text || '/'))
  )
);

create table selections (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  photo_id uuid references photos(id) on delete cascade not null,
  -- מי סימן את זה - כל משתתף (ראו gallery_participants) שומר את הבחירות שלו
  -- בנפרד, כדי שאפשר יהיה להראות "מי בחר מה" בלי לערבב בין אנשים.
  participant_id uuid references gallery_participants(id) on delete cascade not null,
  status text default 'selected' check (status in ('maybe', 'selected')),
  note text,
  -- תגובת הצלמת להערה שהלקוחה כתבה (note למעלה) - ראו
  -- app/api/galleries/[id]/photos/[photoId]/reply/route.ts. עד עכשיו ההערה
  -- הייתה חד-כיוונית (הלקוחה כותבת, הצלמת רק קוראת ב-app/dashboard/upload/[galleryId]/page.tsx) -
  -- זה נותן לצלמת דרך לענות ("סוכם!"/לשאול הבהרה) בלי לצאת לוואטסאפ/מייל.
  photographer_reply text,
  photographer_reply_at timestamptz,
  selected_at timestamptz default now(),
  unique (gallery_id, photo_id, participant_id)
);

-- תמונות ערוכות סופיות שהצלמת מוסרת ללקוחה בתוך האפליקציה (ראו README/התכנון:
-- "מסירת תמונות ערוכות") - טבלה נפרדת לגמרי מ-photos ולא הרחבה שלה: אין
-- thumbnail/sharpness/סימן מים, ואין קשר ישיר ל-selections (הצלמת מעלה batch
-- חופשי של קבצים ערוכים, לא מתאימה קובץ-קובץ לתמונת מקור/בחירה ספציפית).
create table delivered_photos (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  -- נתיב בתוך אותו bucket פרטי gallery-photos, תחת תת-תיקיית {galleryId}/final/ -
  -- בדיוק כמו thumbs/, ה-URL בפועל נוצר כ-signed URL זמני, ראו app/api/gallery/[id]/route.ts
  file_path text not null,
  original_filename text not null,
  -- מתי הקובץ הזה הועבר בפועל ל-Cloudflare R2 (מעבר אחסון חד-פעמי, ראו
  -- קוד המיגרציה הוסר מאז) - null = עדיין ב-Supabase Storage
  -- בלבד. בניגוד ל-photos למעלה, יש כאן רק עמודה אחת כי לתמונה סופית אין
  -- thumbnail נפרד - זה הקובץ הערוך המלא בעצמו.
  file_migrated_at timestamptz,
  created_at timestamptz default now(),
  -- אותה הגנה כמו photos_paths_in_gallery - file_path נכתב מהדפדפן
  constraint delivered_photos_path_in_gallery check (starts_with(file_path, gallery_id::text || '/'))
);
create index idx_delivered_photos_gallery on delivered_photos(gallery_id);
alter table delivered_photos enable row level security;
create policy "photographers see own delivered photos" on delivered_photos
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

-- תשלומים שהתקבלו בפועל על גלריה (מקדמה, יתרה, כמה תשלומים חלקיים) - רישום
-- ידני של הצלמת, אין אינטגרציית סליקה. היתרה = הסכום לתשלום (ראו
-- galleries.amount_due_override) פחות סכום השורות כאן. רק הצלמת רואה/כותבת
-- (RLS למטה), הלקוחה לא נחשפת לזה בשום API שלה.
create table gallery_payments (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  amount numeric(10,2) not null check (amount > 0),
  -- תאריך קבלת התשלום (לוח אזרחי בישראל, לא רגע מדויק) - ברירת מחדל היום
  paid_on date not null default current_date,
  -- אמצעי תשלום, טקסט חופשי קצר (מזומן/ביט/העברה/צ'ק...) - אופציונלי
  method text,
  note text,
  created_at timestamptz default now()
);
create index idx_gallery_payments_gallery on gallery_payments(gallery_id);
alter table gallery_payments enable row level security;
create policy "photographers see own gallery payments" on gallery_payments
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ))
  with check (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

-- יומן צילומים: צילום מתוכנן (לפני שיש גלריה) - ראו app/dashboard/calendar/page.tsx
-- ו-lib/shoots.ts. shoot_date + start_time הם שעון אזרחי בישראל (Asia/Jerusalem),
-- בכוונה בלי אזור זמן - כך הצלמת מזינה אותם, וההמרה לרגע מדויק נעשית רק
-- בקוד (israelLocalToUtcIso) כשצריך לדעת אם הצילום כבר התחיל.
create table shoots (
  id uuid primary key default uuid_generate_v4(),
  photographer_id uuid references photographers(id) on delete cascade not null,
  -- אותה טבלת clients של הגלריות - לקוחה קיימת או חדשה שנוצרת מטופס הצילום.
  client_id uuid references clients(id) on delete cascade not null,
  -- קישור אופציונלי לגלריה שנוצרה אחרי הצילום. מחיקת הגלריה לא מוחקת את הצילום.
  gallery_id uuid references galleries(id) on delete set null,
  shoot_date date not null,
  start_time time not null,
  location text not null,
  -- הערות פרטיות של הצלמת - לא נשלחות ללקוחה, רק בסיכום היומי לצלמת.
  notes text,
  confirmation_sent_at timestamptz,
  -- מתי נשלחה התזכורת האוטומטית ללקוחה (app/api/cron/tick/route.ts) - null =
  -- טרם נשלחה. חד-פעמית, כמו galleries.last_reminder_sent_at; מתאפסת כשמזיזים
  -- את הצילום לתאריך/שעה אחרים, כדי שתישלח תזכורת על המועד החדש.
  reminder_sent_at timestamptz,
  created_at timestamptz default now()
);
create index idx_shoots_photographer_date on shoots(photographer_id, shoot_date);
create index idx_shoots_date on shoots(shoot_date);
-- אינדקסים על FK (לחיפוש לפי לקוחה/גלריה ול-cascade/set null במחיקה)
create index if not exists idx_shoots_client on shoots(client_id);
create index if not exists idx_shoots_gallery on shoots(gallery_id);
alter table shoots enable row level security;
-- with check בודק גם שהלקוחה/הגלריה המקושרות שייכות לאותה צלמת - בלי זה
-- (FK לא עובר דרך RLS) אפשר היה לקשר צילום ל-client_id של צלמת אחרת.
create policy "photographers see own shoots" on shoots
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
  with check (
    photographer_id in (select id from photographers where auth_user_id = auth.uid())
    and client_id in (
      select id from clients where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
    and (gallery_id is null or gallery_id in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    ))
  );

create table packages (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null unique,
  included_photos int not null default 0,
  extra_photo_price numeric(10,2) default 0,
  -- מחיר החבילה עצמה (לא לתמונה נוספת) - מה שהצלמת גובה בפועל על הגלריה,
  -- בנפרד מ-amount_charged (שנשאר ריק עד שיש אינטגרציית סליקה אמיתית, ראו README).
  -- בלי השדה הזה דוח ההכנסות בדשבורד (app/dashboard/galleries/page.tsx) יכול
  -- להראות רק חריגות, לא את ההכנסה האמיתית מהחבילות עצמן.
  base_price numeric(10,2) default 0,
  amount_charged numeric(10,2) default 0
);

create table sync_jobs (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  status text default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  photos_copied int default 0,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- הגדרות כלל-מערכתיות (לא לפי צלם/גלריה) - כרגע רק כתובת השליחה של Resend
-- (RESEND_FROM_EMAIL), כדי שאפשר יהיה לעדכן אותה מ-/dashboard/admin אחרי
-- שיש דומיין מאומת, בלי לגעת במשתני סביבה ב-Vercel. RLS מופעל בלי אף
-- policy בכוונה - גישה רק דרך service_role (app/api/admin/settings), אותו
-- דפוס כמו is_unlimited על photographers.
create table app_settings (
  key text primary key,
  value text
);
alter table app_settings enable row level security;

-- יומן מיילים ידניים (לחיצת כפתור של הצלמת: הזמנה מחדש, תזכורת, "התמונות
-- מוכנות", בקשת ביקורת, עדכון צילום) - בסיס למגבלת הקצב בשרת
-- (lib/manualEmailCooldown.ts, lib/manualEmailLog.ts): 60 שניות בין שליחות
-- מאותו סוג לאותה גלריה/צילום, ועד 10 ב-24 שעות. שורה נרשמת רק אחרי שליחה
-- מוצלחת. מיילים אוטומטיים (cron) לא נרשמים כאן.
create table manual_email_sends (
  id uuid primary key default uuid_generate_v4(),
  photographer_id uuid references photographers(id) on delete cascade not null,
  gallery_id uuid references galleries(id) on delete cascade,
  shoot_id uuid references shoots(id) on delete cascade,
  email_type text not null check (email_type in ('invite', 'reminder', 'delivery', 'review', 'shoot_update')),
  sent_at timestamptz default now() not null,
  check (gallery_id is not null or shoot_id is not null)
);
create index idx_manual_email_sends_gallery on manual_email_sends(gallery_id, email_type, sent_at) where gallery_id is not null;
create index idx_manual_email_sends_shoot on manual_email_sends(shoot_id, email_type, sent_at) where shoot_id is not null;
create index idx_manual_email_sends_photographer on manual_email_sends(photographer_id);
alter table manual_email_sends enable row level security;
-- with check מוודא שהגלריה/הצילום שייכים לאותה צלמת (FK לא עובר דרך RLS)
create policy "photographers manage own manual email sends" on manual_email_sends
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
  with check (
    photographer_id in (select id from photographers where auth_user_id = auth.uid())
    and (gallery_id is null or gallery_id in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    ))
    and (shoot_id is null or shoot_id in (
      select id from shoots where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    ))
  );

-- בקשות הארכה של תקופת הבחירה מצד הלקוחה (הבעלים בלבד) - כפתור "לבקש
-- הארכה" בבאנר הספירה לאחור בגלריה. מגבלות (נאכפות בשרת, lib/extensionRequests.ts):
-- עד 2 בקשות לגלריה בסך הכל, עד 7 ימים לבקשה, ובקשה ממתינה אחת בכל פעם
-- (האינדקס הייחודי החלקי למטה - גם מול בקשות מקבילות). הלקוחה ניגשת רק דרך
-- app/api/gallery/[id]/extension-request (service_role אחרי בדיקת session
-- הגלריה + בעלים), לכן אין לה policy. הצלמת רואה ומעדכנת (אישור/דחייה) רק
-- בקשות של הגלריות שלה - app/api/galleries/[id]/extension-requests.
create table gallery_extension_requests (
  id uuid primary key default uuid_generate_v4(),
  gallery_id uuid references galleries(id) on delete cascade not null,
  participant_id uuid references gallery_participants(id) on delete set null,
  requested_days int not null check (requested_days between 1 and 7),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz default now() not null,
  decided_at timestamptz
);
create index idx_gallery_extension_requests_gallery on gallery_extension_requests(gallery_id);
create unique index gallery_extension_requests_one_pending on gallery_extension_requests(gallery_id) where status = 'pending';
alter table gallery_extension_requests enable row level security;
create policy "photographers select own extension requests" on gallery_extension_requests
  for select using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));
create policy "photographers update own extension requests" on gallery_extension_requests
  for update using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ))
  with check (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

-- אינדקסים בסיסיים לביצועים
create index idx_clients_photographer on clients(photographer_id);
create index idx_galleries_photographer on galleries(photographer_id);
create index idx_photos_gallery on photos(gallery_id);
-- partial - רוב התמונות אינן מתנה, וכל שאילתות המתנה מסננות is_gift = true
create index idx_photos_gallery_gift on photos(gallery_id) where is_gift;
create index idx_selections_gallery on selections(gallery_id);
create index idx_gallery_participants_gallery on gallery_participants(gallery_id);
-- אינדקסים על עמודות FK שהיו חסרים - בלעדיהם כל delete על photos/
-- gallery_participants/clients/galleries (cascade) סורק את כל הטבלה המפנה.
create index if not exists idx_selections_photo on selections(photo_id);
create index if not exists idx_selections_participant on selections(participant_id);
create index if not exists idx_galleries_client on galleries(client_id);
create index if not exists idx_sync_jobs_gallery on sync_jobs(gallery_id);

-- Row Level Security: כל צלם רואה רק את הנתונים שלו
alter table photographers enable row level security;
alter table clients enable row level security;
alter table galleries enable row level security;
alter table photos enable row level security;
alter table selections enable row level security;
alter table packages enable row level security;
alter table sync_jobs enable row level security;
alter table gallery_participants enable row level security;

-- with check זהה ל-using: "for all" בלי with check מפורש היה גורם ל-postgres
-- להשתמש ב-using כברירת מחדל גם בשביל insert/update, אבל זה עדיין היה מתיר
-- לצלמת מחוברת לכתוב ערך שרירותי בכל עמודה אחרת בשורה שלה (is_unlimited,
-- ai_picks_count/date, theme_gen_count/date) - הבדיקה האמיתית לעמודות האלה
-- היא בטריגרים protect_is_unlimited/protect_ai_usage_counters למטה, לא כאן.
-- select + update בלבד (לא for all): אין שום סיבה שצלמת תמחק/תיצור שורת
-- photographers בעצמה עם ה-session - היצירה נעשית ע"י הטריגר security definer
-- handle_new_photographer, ומחיקה רק דרך מחיקת המשתמש ב-Auth (on delete cascade).
create policy "photographers select own row" on photographers
  for select using (auth.uid() = auth_user_id);

create policy "photographers update own row" on photographers
  for update using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

create policy "photographers see own clients" on clients
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()));

-- ===== with check חוצה-דיירים על galleries/selections =====
-- FK לא עובר דרך RLS, אז בלי with check מפורש צלמת יכלה לקשר גלריה ל-client_id
-- של צלמת אחרת, או selection ל-photo_id/participant_id מגלריה אחרת (אותו דפוס
-- כמו "photographers see own shoots" למעלה).
-- owner_participant_id נבדק דרך פונקציית security definer ולא בתת-שאילתה ישירה
-- על gallery_participants: ה-policy של gallery_participants עצמה מפנה ל-galleries,
-- ו-postgres זורק "infinite recursion detected in policy" על מעגל כזה. בטוח
-- כי הפונקציה רק עונה "האם participant X שייך לגלריה Y", והבעלות על הגלריה
-- עצמה כבר נבדקת בנפרד בתנאי photographer_id.
create or replace function public.participant_belongs_to_gallery(p_participant_id uuid, p_gallery_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.gallery_participants
    where id = p_participant_id and gallery_id = p_gallery_id
  );
$$ language sql stable security definer set search_path = public;

create policy "photographers see own galleries" on galleries
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
  with check (
    photographer_id in (select id from photographers where auth_user_id = auth.uid())
    and client_id in (
      select id from clients where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
    and (owner_participant_id is null or public.participant_belongs_to_gallery(owner_participant_id, id))
  );

create policy "photographers see own photos" on photos
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

create policy "photographers see own selections" on selections
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ))
  with check (
    gallery_id in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
    and photo_id in (select p.id from photos p where p.gallery_id = selections.gallery_id)
    and participant_id in (select gp.id from gallery_participants gp where gp.gallery_id = selections.gallery_id)
  );
-- ===== סוף with check חוצה-דיירים =====

create policy "photographers see own gallery participants" on gallery_participants
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

create policy "photographers see own packages" on packages
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

create policy "photographers see own sync jobs" on sync_jobs
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

-- הערה: ללקוחות (client side) אין גישה ישירה דרך anon key בכלל - במכוון.
-- כל הגישה שלהן (טעינת תמונות, בחירה, הערות) עוברת דרך app/api/gallery/[id]/*,
-- שמאמת session חתום (lib/session.ts) ומשתמש ב-service_role key בצד שרת.
-- כך access_code לא צריך להיות חשוף ל-RLS בכלל, וההרשאה כולה נשארת בצד שרת.

-- אם כבר הרצת גרסה קודמת של הסכמה בלי עמודת status, מריצים גם את זה:
-- alter table selections add column if not exists status text default 'selected' check (status in ('maybe', 'selected'));

-- אם כבר הרצת גרסה קודמת בלי השדות החדשים על galleries, מריצים גם את זה:
-- alter table galleries add column if not exists last_activity_at timestamptz;
-- alter table galleries add column if not exists last_reminder_sent_at timestamptz;

-- אם כבר הרצת גרסה קודמת עם file_url/thumbnail_url (URL ציבורי) במקום
-- file_path/thumbnail_path (נתיב ב-bucket פרטי), מריצים גם את זה:
-- alter table photos rename column file_url to file_path;
-- alter table photos rename column thumbnail_url to thumbnail_path;

-- אם כבר הרצת גרסה קודמת בלי הגנת brute-force על קוד הגישה, מריצים גם את זה:
-- alter table clients add column if not exists failed_access_attempts int default 0;
-- alter table clients add column if not exists locked_until timestamptz;

-- אם כבר הרצת גרסה קודמת בלי טקסט מותאם אישית לסימן המים, מריצים גם את זה:
-- alter table photographers add column if not exists watermark_text text;

-- אם כבר הרצת גרסה קודמת בלי מגבלת חשבון חינמי, מריצים גם את הטריגרים
-- שמוגדרים למטה (enforce_active_gallery_limit, enforce_photo_limit) בנפרד.

-- אם כבר הרצת גרסה קודמת בלי ציון חדות לתמונות, מריצים גם את זה:
-- alter table photos add column if not exists sharpness_score numeric;

-- אם כבר הרצת גרסה קודמת בלי מחיר חבילה בסיסי, מריצים גם את זה:
-- alter table packages add column if not exists base_price numeric(10,2) default 0;

-- אם כבר הרצת גרסה קודמת בלי ברירות מחדל לחבילה חדשה, מריצים גם את זה:
-- alter table photographers add column if not exists default_included_photos int default 30 not null;
-- alter table photographers add column if not exists default_base_price numeric(10,2) default 0 not null;
-- alter table photographers add column if not exists default_extra_photo_price numeric(10,2) default 0 not null;

-- אם כבר הרצת גרסה קודמת בלי טבלת app_settings, מריצים גם את זה:
-- create table if not exists app_settings (key text primary key, value text);
-- alter table app_settings enable row level security;

-- אם כבר הרצת גרסה קודמת בלי סימון "נמסר" לגלריה, מריצים גם את זה:
-- alter table galleries add column if not exists delivered_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי סימון "שולם" לגלריה, מריצים גם את זה:
-- alter table galleries add column if not exists paid_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי מונה צפיות לגלריה, מריצים גם את זה:
-- alter table galleries add column if not exists view_count int default 0 not null;
-- alter table galleries add column if not exists last_viewed_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי מונה שימוש יומי ל"עזרי לי לבחור", מריצים גם את זה:
-- alter table photographers add column if not exists ai_picks_count int default 0 not null;
-- alter table photographers add column if not exists ai_picks_date date;

-- אם כבר הרצת גרסה קודמת בלי קישור ביקורת, מריצים גם את זה:
-- alter table photographers add column if not exists review_link text;

-- אם כבר הרצת גרסה קודמת בלי הערות פרטיות של הצלמת על הגלריה, מריצים גם את זה:
-- alter table galleries add column if not exists photographer_notes text;

-- אם כבר הרצת גרסה קודמת בלי סימון "בעריכה" לגלריה, מריצים גם את זה:
-- alter table galleries add column if not exists editing_started_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי חשבונות "ללא הגבלה" (is_unlimited), מריצים גם את זה:
-- alter table photographers add column if not exists is_unlimited boolean default false not null;

-- אם כבר הרצת גרסה קודמת בלי שיתוף גלריה משפחתי (gallery_participants),
-- מריצים את כל הבלוק הזה - כולל backfill לגלריות/בחירות קיימות, כדי שלכל
-- גלריה יהיה participant "בעלים" (לפי שם הלקוחה הרשומה) ולכל selection קיים
-- יהיה participant_id תקין לפני שהעמודה הופכת ל-not null:
--
-- create table if not exists gallery_participants (
--   id uuid primary key default uuid_generate_v4(),
--   gallery_id uuid references galleries(id) on delete cascade not null,
--   display_name text not null,
--   is_owner boolean default false not null,
--   created_at timestamptz default now()
-- );
-- create unique index if not exists gallery_participants_one_owner_idx on gallery_participants(gallery_id) where is_owner;
-- alter table galleries add column if not exists owner_participant_id uuid references gallery_participants(id);
-- alter table selections add column if not exists participant_id uuid references gallery_participants(id) on delete cascade;
--
-- insert into gallery_participants (gallery_id, display_name, is_owner)
-- select g.id, c.full_name, true
-- from galleries g
-- join clients c on c.id = g.client_id
-- where not exists (select 1 from gallery_participants gp where gp.gallery_id = g.id and gp.is_owner);
--
-- update galleries g set owner_participant_id = gp.id
-- from gallery_participants gp
-- where gp.gallery_id = g.id and gp.is_owner and g.owner_participant_id is null;
--
-- update selections s set participant_id = g.owner_participant_id
-- from galleries g
-- where s.gallery_id = g.id and s.participant_id is null;
--
-- alter table selections alter column participant_id set not null;
-- alter table selections drop constraint if exists selections_gallery_id_photo_id_key;
-- alter table selections add constraint selections_gallery_id_photo_id_participant_id_key unique (gallery_id, photo_id, participant_id);

-- מעדכן אוטומטית את "פעילות אחרונה" בגלריה בכל בחירה/ביטול בחירה של לקוחה,
-- ומעביר את הסטטוס ל-in_progress באירוע הבחירה הראשון (draft/sent -> in_progress).
-- מעבר ל-completed הוא פעולה מפורשת של הלקוחה (app/api/gallery/[id]/finish/route.ts),
-- ומעבר ל-expired קורה בזמן (app/api/cron/tick/route.ts) - שניהם לא כאן, כי טריגר
-- שרץ רק על שינוי ב-selections לא יכול לתפוס "עבר הזמן" בלי שום פעולה.
create or replace function update_gallery_last_activity()
returns trigger as $$
begin
  -- תגובת צלמת להערה (photographer_reply/photographer_reply_at, ראו
  -- app/api/galleries/[id]/photos/[photoId]/reply) היא לא "פעילות של הלקוחה" -
  -- בלי הדילוג הזה כל תגובה הייתה מזיזה את last_activity_at (ומשבשת תזכורות)
  -- ואף מעבירה גלריה sent ל-in_progress בלי שהלקוחה נגעה בה.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'photographer_reply' - 'photographer_reply_at')
         = (to_jsonb(old) - 'photographer_reply' - 'photographer_reply_at') then
    return new;
  end if;

  update galleries
  set last_activity_at = now(),
      status = case when status in ('draft', 'sent') then 'in_progress' else status end
  where id = coalesce(new.gallery_id, old.gallery_id);
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_selections_activity
after insert or update or delete on selections
for each row execute function update_gallery_last_activity();

-- ===== הגנה על מעברי סטטוס של galleries (רק service_role) =====
-- מעבר ל-completed (app/api/gallery/[id]/finish) ול-expired (app/api/cron/tick)
-- נעשים רק בצד שרת עם מפתח service_role. בלי ההגנה הזו צלמת מחוברת יכלה
-- מקונסולת הדפדפן ליצור גלריה ישירות כ-completed/expired (ולעקוף את
-- enforce_active_gallery_limit, שלא סופר גלריות כאלה), להכניס גלריה עם
-- reopened_for_selection_at מוכן מראש, או לסמן בעצמה גלריה כ-completed.
-- חוסמים רק תפקידי JWT של לקוח (authenticated/anon) - service_role וחיבור
-- ישיר ל-DB (SQL editor, auth.role() = null) עוברים כרגיל. פתיחה/נעילה מחדש
-- של reopened_for_selection_at ב-UPDATE (app/api/galleries/[id]/reopen-selection,
-- session הצלמת) נשארת מותרת בכוונה, וגם המעבר האוטומטי draft/sent ->
-- in_progress מטריגר trg_selections_activity.
create or replace function guard_gallery_status_transitions()
returns trigger as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is null or new.status not in ('draft', 'sent') then
      raise exception 'GALLERY_STATUS_FORBIDDEN: גלריה חדשה יכולה להיווצר רק בסטטוס draft או sent';
    end if;
    if new.reopened_for_selection_at is not null then
      raise exception 'GALLERY_STATUS_FORBIDDEN: אי אפשר להגדיר reopened_for_selection_at ביצירת גלריה';
    end if;
  elsif new.status is distinct from old.status and new.status in ('completed', 'expired') then
    raise exception 'GALLERY_STATUS_FORBIDDEN: מעבר לסטטוס completed/expired מותר רק מצד השרת';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_gallery_status_transitions on galleries;
create trigger trg_guard_gallery_status_transitions
before insert or update on galleries
for each row execute function guard_gallery_status_transitions();
-- ===== סוף הגנה על מעברי סטטוס =====

-- מעדכן אוטומטית את delivered_at בהעלאה הראשונה של תמונה סופית (ראו
-- delivered_photos למעלה) - כך שהצלמת לא צריכה לזכור ללחוץ גם על כפתור
-- "סימון כנמסר" הידני הקיים (toggle-delivered) בנוסף להעלאה עצמה. coalesce
-- שומר על התאריך המקורי אם כבר סומן ידנית קודם - לא דורס אותו בכל העלאה
-- נוספת. בכוונה לא ההפך: מחיקת כל התמונות הסופיות לא "מבטלת" delivered_at -
-- scope-out מכוון, הצלמת יכולה תמיד להפוך ידנית דרך toggle-delivered.
create or replace function mark_gallery_delivered()
returns trigger as $$
begin
  update galleries set delivered_at = coalesce(delivered_at, now()) where id = new.gallery_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_delivered_photos_mark_delivered
after insert on delivered_photos
for each row execute function mark_gallery_delivered();

-- מתחברת ל-Supabase Auth: כשנרשם משתמש חדש (auth.users), יוצרים לו אוטומטית
-- שורת photographers מתאימה. שם העסק מגיע מ-user metadata (options.data.business_name
-- ב-supabase.auth.signUp, ראו app/login/page.tsx). security definer כדי לעקוף RLS -
-- זה בטוח כי הטריגר תמיד מכניס auth_user_id = new.id (המשתמש שממש נוצר),
-- ולא לפי קלט חיצוני.
create or replace function public.handle_new_photographer()
returns trigger as $$
begin
  insert into public.photographers (auth_user_id, business_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'business_name', 'ללא שם'));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_photographer();

-- מגבלת חשבון חינמי (עדיין אין מנוי בתשלום לצלמות - ראו README): גלריה פעילה
-- אחת בכל רגע נתון, ועד 25 תמונות בגלריה. מספיק כדי לנסות את המערכת, לא מספיק
-- כדי לנהל איתה עסק צילום אמיתי. אכיפה ברמת ה-DB (טריגר, לא רק בקוד ה-API) כדי
-- שאי אפשר יהיה לעקוף את זה דרך קריאה ישירה ל-Supabase.
-- before insert or update (לא רק insert!): אחרת צלמת מחוברת יכלה לעקוף את
-- המגבלה לגמרי ע"י UPDATE ישיר על גלריה completed/expired קיימת שלה בחזרה
-- לסטטוס פעיל (draft/sent/in_progress) - קריאת update אף פעם לא מפעילה
-- טריגר שמוגדר רק על insert. בודקים את הספירה רק כשגלריה בפועל "נפתחת" -
-- insert של גלריה פעילה, או update שהופך גלריה לא-פעילה לפעילה (status
-- חוזר מ-completed/expired, או reopened_for_selection_at הופך ללא-null) - כדי לא להריץ את הבדיקה בכל update רגיל של גלריה שכבר
-- פעילה (למשל מעבר sent -> in_progress בכל כניסה של לקוחה, ראו
-- app/api/gallery/[id]/route.ts).
create or replace function enforce_active_gallery_limit()
returns trigger as $$
declare
  active_count int;
  unlimited boolean;
  new_active boolean;
  should_check boolean;
begin
  -- "פעילה" = עדיין בבחירה (status לא completed/expired) או שהצלמת פתחה
  -- אותה מחדש לבחירה (reopened_for_selection_at) - מבחינת הלקוחה זו גלריה
  -- פעילה לכל דבר, ובלי זה פתיחה מחדש (גם ישירות מהדפדפן דרך ה-RLS) עקפה
  -- את המגבלה.
  new_active := new.status not in ('completed', 'expired') or new.reopened_for_selection_at is not null;

  if not new_active then
    should_check := false;
  elsif tg_op = 'INSERT' then
    should_check := true;
  else
    should_check := not (old.status not in ('completed', 'expired') or old.reopened_for_selection_at is not null);
  end if;

  if not should_check then
    return new;
  end if;

  select is_unlimited into unlimited from photographers where id = new.photographer_id;
  if unlimited then
    return new;
  end if;

  -- מנעול advisory בתוך הטרנזקציה (לפי photographer_id), לפני הספירה: בלי זה
  -- שתי הכנסות/עדכונים מקבילים על אותה צלמת יכולים לקרוא את אותה ספירה
  -- "לפני" ולעבור את הבדיקה שניהם (race condition קלאסי - TOCTOU), ולחרוג
  -- בפועל ממגבלת גלריה פעילה אחת. המנעול משתחרר אוטומטית בסוף הטרנזקציה,
  -- אין row ממשי לנעול כי הספירה נגזרת (derived) ולא שורה בודדת.
  perform pg_advisory_xact_lock(hashtext(new.photographer_id::text));

  select count(*) into active_count
  from galleries
  where photographer_id = new.photographer_id
    and id <> new.id
    and (status not in ('completed', 'expired') or reopened_for_selection_at is not null);

  if active_count >= 1 then
    raise exception 'LIMIT_ACTIVE_GALLERY: חשבון חינמי מוגבל לגלריה פעילה אחת - השלימי או מחקי גלריה קיימת כדי ליצור חדשה';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_active_gallery_limit on galleries;
create trigger trg_enforce_active_gallery_limit
before insert or update on galleries
for each row execute function enforce_active_gallery_limit();

-- before insert or update (לא רק insert!): אחרת צלמת מחוברת יכלה לעקוף את
-- מגבלת 25 התמונות ע"י UPDATE של gallery_id על תמונה קיימת שלה (מגלריה
-- אחרת) לתוך גלריה שכבר מלאה - קריאת update אף פעם לא מפעילה טריגר שמוגדר
-- רק על insert. בודקים את הספירה רק כשה-gallery_id בפועל משתנה (insert, או
-- update שמעביר תמונה לגלריה אחרת) - כדי לא להריץ את הבדיקה בכל update רגיל
-- של תמונה בתוך אותה גלריה (למשל עדכון thumbnail_path/sharpness_score, ראו
-- app/api/galleries/[id]/photos/[photoId]/process/route.ts), שהיה חוסם
-- בטעות עדכונים כאלה ברגע שגלריה כבר בדיוק במגבלה.
create or replace function enforce_photo_limit()
returns trigger as $$
declare
  photo_count int;
  unlimited boolean;
  should_check boolean;
begin
  if tg_op = 'INSERT' then
    should_check := true;
  else
    should_check := new.gallery_id is distinct from old.gallery_id;
  end if;

  if not should_check then
    return new;
  end if;

  select p.is_unlimited into unlimited
  from galleries g join photographers p on p.id = g.photographer_id
  where g.id = new.gallery_id;

  if unlimited then
    return new;
  end if;

  -- מנעול advisory בתוך הטרנזקציה (לפי gallery_id), מאותה סיבה בדיוק כמו
  -- ב-enforce_active_gallery_limit למעלה: בלי זה, הכנסות מקבילות לאותה
  -- גלריה (למשל 8 הכנסות תמונות במקביל באפלוד - UPLOAD_CONCURRENCY ב-
  -- app/dashboard/upload/[galleryId]/page.tsx) יכולות כולן לקרוא את אותה
  -- ספירה "לפני" ולעבור את הבדיקה, ולחרוג בפועל מ-25 התמונות המותרות.
  perform pg_advisory_xact_lock(hashtext(new.gallery_id::text));

  select count(*) into photo_count
  from photos
  where gallery_id = new.gallery_id;

  if photo_count >= 25 then
    raise exception 'LIMIT_PHOTOS: חשבון חינמי מוגבל ל-25 תמונות בגלריה';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_photo_limit
before insert or update on photos
for each row execute function enforce_photo_limit();

-- מונע מצלמת לסמן את עצמה כ"ללא הגבלה" - ה-RLS "photographers see own row"
-- (for all, עם with check שבודק רק auth_user_id) מאפשר לה לעדכן את השורה שלה
-- בעצמה, אז בלי ההגנה הזו כל אחת הייתה יכולה לפתוח את קונסולת הדפדפן ולעקוף
-- את מגבלת החשבון החינמי בעצמה. כולל גם before insert (לא רק update!) - אחרת
-- צלמת יכלה לעקוף את זה ע"י מחיקת השורה שלה (delete, מותר לה ב-RLS) ויצירת
-- שורה חדשה עם is_unlimited=true ישירות ב-insert. רק עדכון/הכנסה עם מפתח
-- service_role (ראו app/api/admin/*) יכולים לשנות את השדה הזה.
create or replace function protect_is_unlimited()
returns trigger as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_unlimited := false;
  elsif new.is_unlimited is distinct from old.is_unlimited then
    new.is_unlimited := old.is_unlimited;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_protect_is_unlimited
before insert or update on photographers
for each row execute function protect_is_unlimited();

-- אותה הגנה בדיוק, אבל על מוני השימוש היומיים ל-AI: ai_picks_count/ai_picks_date
-- ("עזרי לי לבחור", app/api/gallery/[id]/ai-picks/route.ts) ו-theme_gen_count/
-- theme_gen_date ("עיצוב הגלריה עם AI", app/api/photographer/design-theme/route.ts).
-- בלי הגנה כאן, צלמת מחוברת יכלה לאפס את המונים האלה מקונסולת הדפדפן ולקבל
-- קריאות AI חינמיות ללא הגבלה (עלות בפועל מול Anthropic). שני ה-routes האלה
-- כותבים לעמודות האלה אך ורק עם מפתח service_role, אז זה בטוח לחסום כל כתיבה
-- אחרת - כולל insert, מאותה סיבה שמוסברת ב-protect_is_unlimited למעלה.
create or replace function protect_ai_usage_counters()
returns trigger as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ai_picks_count := 0;
    new.ai_picks_date := null;
    new.theme_gen_count := 0;
    new.theme_gen_date := null;
  else
    if new.ai_picks_count is distinct from old.ai_picks_count then
      new.ai_picks_count := old.ai_picks_count;
    end if;
    if new.ai_picks_date is distinct from old.ai_picks_date then
      new.ai_picks_date := old.ai_picks_date;
    end if;
    if new.theme_gen_count is distinct from old.theme_gen_count then
      new.theme_gen_count := old.theme_gen_count;
    end if;
    if new.theme_gen_date is distinct from old.theme_gen_date then
      new.theme_gen_date := old.theme_gen_date;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_protect_ai_usage_counters
before insert or update on photographers
for each row execute function protect_ai_usage_counters();

-- ===== הגנה על עמודות פנימיות של photographers =====
-- shoot_summary_sent_on נכתב רק ע"י ה-cron (app/api/cron/tick, service_role) -
-- בלי ההגנה הזו צלמת יכלה לשנות אותו בעצמה ולשבש את ה-idempotency של הסיכום
-- היומי. אותו דפוס בדיוק כמו protect_ai_usage_counters למעלה.
create or replace function protect_internal_photographer_columns()
returns trigger as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.shoot_summary_sent_on := null;
  elsif new.shoot_summary_sent_on is distinct from old.shoot_summary_sent_on then
    new.shoot_summary_sent_on := old.shoot_summary_sent_on;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_protect_internal_photographer_columns on photographers;
create trigger trg_protect_internal_photographer_columns
before insert or update on photographers
for each row execute function protect_internal_photographer_columns();
-- ===== סוף הגנה על עמודות פנימיות =====

-- הגנת brute-force על קוד הגישה (clients.failed_access_attempts/locked_until,
-- ראו lib/accessLockout.ts) הייתה מיושמת ב-app/api/verify-access/route.ts כ-
-- read-then-write רגיל בקוד ה-JS: קוראים failed_access_attempts, מחשבים בצד
-- שרת (Node) את הערך הבא, וכותבים UPDATE נפרד. זה TOCTOU קלאסי - כמה בקשות
-- שגויות שמגיעות במקביל (לא ברצף) כולן קוראות את אותו failed_access_attempts
-- "לפני" שאף אחת מהן הספיקה לכתוב, כך שכולן עוברות את בדיקת isLockedOut
-- ומקבלות תשובת "קוד שגוי" משלהן - התוקף יכול לצרוך פי כמה מ-MAX_ATTEMPTS
-- ניחושים בכל חלון נעילה במקום להיחסם אחרי 5 בדיוק. הפונקציה הבאה מבצעת את
-- כל הרצף - נעילת השורה, קריאה, חישוב, כתיבה - בטרנזקציה אטומית אחת ב-DB
-- (SELECT ... FOR UPDATE נועל את שורת ה-client הספציפית עד סוף הטרנזקציה,
-- אז בקשה מקבילה שנייה על אותו client_id ממתינה בפועל לשחרור הנעילה ורק אז
-- קוראת את הערך המעודכן - לא את אותו ערך "לפני" כמו קודם). הלוגיקה הפנימית
-- (מגדילים תמיד, ננעלים רק בהגעה ל-5, לא נועלים מחדש בכל כשל נוסף אחרי
-- שנעילה קודמת פגה) זהה בכוונה ל-afterFailedAttempt הטהורה ב-lib/accessLockout.ts -
-- הפונקציה הזו נשארת כמו שהיא (עדיין משמשת לבדיקה המהירה isLockedOut בתחילת
-- הבקשה, לפני שנוגעים ב-DB בכלל, וב-supabase/../accessLockout.test.ts הקיימים),
-- רק שנתיב הכשל בפועל (הגדלת המונה + נעילה) עבר לכאן כדי לסגור את המרוץ.
create or replace function register_failed_access_attempt(p_client_id uuid)
returns table (already_locked_out boolean, failed_attempts int, locked_until timestamptz) as $$
declare
  current_attempts int;
  current_locked_until timestamptz;
  new_attempts int;
  new_locked_until timestamptz;
begin
  select c.failed_access_attempts, c.locked_until
  into current_attempts, current_locked_until
  from clients c
  where c.id = p_client_id
  for update;

  if not found then
    return query select false, 0, null::timestamptz;
    return;
  end if;

  -- כבר נעולה (בקשה מקבילה קודמת באותו בלנטש הספיקה להגיע ל-MAX_ATTEMPTS
  -- ולנעול, בין שהבקשה הזו קראה את המצב הישן ל-isLockedOut ובין שלא) - לא
  -- מגדילים הלאה, רק מדווחים שהיא כבר נעולה כדי שה-route יחזיר 429 ולא 401.
  if current_locked_until is not null and current_locked_until > now() then
    return query select true, coalesce(current_attempts, 0), current_locked_until;
    return;
  end if;

  -- נעילה קודמת שכבר הסתיימה: מתחילים לספור מחדש מ-0 - אחרת המונה נשאר על
  -- 5+ וכל טעות בודדת אחרי הנעילה הייתה נועלת מחדש מיד ל-15 דקות.
  if current_locked_until is not null and current_locked_until <= now() then
    current_attempts := 0;
  end if;

  new_attempts := coalesce(current_attempts, 0) + 1;
  if new_attempts >= 5 then -- MAX_ATTEMPTS, ראו lib/accessLockout.ts
    new_locked_until := now() + interval '15 minutes'; -- LOCKOUT_MINUTES, ראו lib/accessLockout.ts
  else
    new_locked_until := null;
  end if;

  update clients
  set failed_access_attempts = new_attempts,
      locked_until = new_locked_until
  where id = p_client_id;

  return query select false, new_attempts, new_locked_until;
end;
$$ language plpgsql;

-- אותה לוגיקה בדיוק (afterFailedAttempt ב-lib/accessLockout.ts), אבל על מונה
-- נפרד: ניסיונות שגויים באימות "זאת אני" - הקלדת המייל של הלקוחה הרשומה
-- (app/api/gallery/[id]/identify/route.ts). נפרד מ-failed_access_attempts כי
-- verify-access מאפס את המונה ההוא בכל קוד נכון, ומי שמחזיק בקוד היה יכול
-- לנחש מיילים בלי הגבלה ע"י הקלדה חוזרת של הקוד בין ניחוש לניחוש.
create or replace function register_failed_owner_claim(p_client_id uuid)
returns table (already_locked_out boolean, failed_attempts int, locked_until timestamptz) as $$
declare
  current_attempts int;
  current_locked_until timestamptz;
  new_attempts int;
  new_locked_until timestamptz;
begin
  select c.owner_claim_failed_attempts, c.owner_claim_locked_until
  into current_attempts, current_locked_until
  from clients c
  where c.id = p_client_id
  for update;

  if not found then
    return query select false, 0, null::timestamptz;
    return;
  end if;

  if current_locked_until is not null and current_locked_until > now() then
    return query select true, coalesce(current_attempts, 0), current_locked_until;
    return;
  end if;

  if current_locked_until is not null and current_locked_until <= now() then
    current_attempts := 0;
  end if;

  new_attempts := coalesce(current_attempts, 0) + 1;
  if new_attempts >= 5 then -- MAX_ATTEMPTS, ראו lib/accessLockout.ts
    new_locked_until := now() + interval '15 minutes'; -- LOCKOUT_MINUTES
  else
    new_locked_until := null;
  end if;

  update clients
  set owner_claim_failed_attempts = new_attempts,
      owner_claim_locked_until = new_locked_until
  where id = p_client_id;

  return query select false, new_attempts, new_locked_until;
end;
$$ language plpgsql;

-- אותה בעיה בדיוק (read-then-write על מונה ב-JS, בלי נעילה), אבל על מוני
-- השימוש היומיים ב-AI (theme_gen_count/date ב-app/api/photographer/design-theme,
-- ai_picks_count/date ב-app/api/gallery/[id]/ai-picks) - שם המרוץ הוא בין
-- לשוניות/בני משפחה שלוחצים כמעט יחד, וההשפעה היא עלות (קריאות Anthropic
-- בתשלום מעבר ל-DAILY_LIMIT), לא אבטחה. אותו פתרון: "reserve" אטומי אחד -
-- בדיקה + הגדלה יחד, לפני קריאת ה-AI - עם SELECT ... FOR UPDATE שנועל את
-- שורת הצלמת כדי ששתי בקשות מקבילות לא יקראו שתיהן את אותו usedToday "לפני".
-- מחזירה true אם "נתפסה" מכסה (מותר להמשיך לקרוא ל-AI), false אם המכסה
-- היומית כבר נוצלה (כולל ע"י בקשה מקבילה אחרת שזכתה קודם) - ה-route אז
-- מחזיר 429 בלי לקרוא ל-Anthropic בכלל. בעיצוב הגלריה לא "מחזירים" מכסה
-- שנתפסה אם קריאת ה-AI נכשלת אחר כך (מכסה רכה). ב"עזרי לי לבחור" כן מזכים
-- כשאף באטש לא הצליח - ראו release_ai_picks_quota למטה.
create or replace function reserve_theme_gen_quota(p_photographer_id uuid, p_daily_limit int)
returns boolean as $$
declare
  current_count int;
  current_date_val date;
  today date := current_date;
begin
  select p.theme_gen_count, p.theme_gen_date
  into current_count, current_date_val
  from photographers p
  where p.id = p_photographer_id
  for update;

  if not found then
    return false;
  end if;

  if current_date_val is distinct from today then
    current_count := 0;
  end if;

  if coalesce(current_count, 0) >= p_daily_limit then
    return false;
  end if;

  update photographers
  set theme_gen_count = coalesce(current_count, 0) + 1,
      theme_gen_date = today
  where id = p_photographer_id;

  return true;
end;
$$ language plpgsql;

-- זהה ל-reserve_theme_gen_quota למעלה, על זוג העמודות המקביל ai_picks_count/
-- ai_picks_date (ראו app/api/gallery/[id]/ai-picks/route.ts) - פונקציה נפרדת
-- כי אלה שתי מכסות בלתי-תלויות עם תקרות שונות, לא כי הלוגיקה שונה.
create or replace function reserve_ai_picks_quota(p_photographer_id uuid, p_daily_limit int)
returns boolean as $$
declare
  current_count int;
  current_date_val date;
  today date := current_date;
begin
  select p.ai_picks_count, p.ai_picks_date
  into current_count, current_date_val
  from photographers p
  where p.id = p_photographer_id
  for update;

  if not found then
    return false;
  end if;

  if current_date_val is distinct from today then
    current_count := 0;
  end if;

  if coalesce(current_count, 0) >= p_daily_limit then
    return false;
  end if;

  update photographers
  set ai_picks_count = coalesce(current_count, 0) + 1,
      ai_picks_date = today
  where id = p_photographer_id;

  return true;
end;
$$ language plpgsql;

-- זיכוי הרצה אחת של "עזרי לי לבחור" כשאף קריאת AI לא הצליחה (ראו
-- app/api/gallery/[id]/ai-picks/route.ts). אטומי, ומוגבל לאותו יום: אם
-- ai_picks_date כבר לא היום (המונה התאפס ממילא) לא נוגעים, ולא יורדים מתחת ל-0.
create or replace function release_ai_picks_quota(p_photographer_id uuid)
returns void as $$
  update photographers
  set ai_picks_count = ai_picks_count - 1
  where id = p_photographer_id
    and ai_picks_date = current_date
    and ai_picks_count > 0;
$$ language sql;

-- מונה צפיות של הלקוחה (galleries.view_count, app/api/gallery/[id]/route.ts) -
-- הגדלה אטומית ב-UPDATE אחד במקום read-then-write ב-JS, שאיבד ספירות בטעינות מקבילות.
create or replace function increment_gallery_view_count(p_gallery_id uuid)
returns void as $$
  update galleries
  set view_count = view_count + 1,
      last_viewed_at = now()
  where id = p_gallery_id;
$$ language sql;

-- ===== הרשאות הרצה לפונקציות האטומיות - service_role בלבד =====
-- שלושתן נקראות רק עם מפתח service_role (app/api/verify-access,
-- app/api/photographer/design-theme, app/api/gallery/[id]/ai-picks). Supabase
-- נותן כברירת מחדל execute ל-anon/authenticated על כל פונקציה ב-public, כך שבלי
-- זה כל אחד יכול היה לקרוא להן ישירות דרך /rest/v1/rpc - למשל לנעול לקוחה
-- אחרת (register_failed_access_attempt) או לשרוף מכסת AI של צלמת אחרת.
revoke execute on function register_failed_access_attempt(uuid) from public, anon, authenticated;
revoke execute on function reserve_theme_gen_quota(uuid, int) from public, anon, authenticated;
revoke execute on function reserve_ai_picks_quota(uuid, int) from public, anon, authenticated;
grant execute on function register_failed_access_attempt(uuid) to service_role;
grant execute on function reserve_theme_gen_quota(uuid, int) to service_role;
grant execute on function reserve_ai_picks_quota(uuid, int) to service_role;
revoke execute on function release_ai_picks_quota(uuid) from public, anon, authenticated;
revoke execute on function increment_gallery_view_count(uuid) from public, anon, authenticated;
grant execute on function release_ai_picks_quota(uuid) to service_role;
grant execute on function increment_gallery_view_count(uuid) to service_role;
revoke execute on function register_failed_owner_claim(uuid) from public, anon, authenticated;
grant execute on function register_failed_owner_claim(uuid) to service_role;
-- ===== סוף הרשאות הרצה =====

-- אם כבר הרצת גרסה קודמת של הסכמה בלי שלוש הפונקציות האטומיות למעלה
-- (register_failed_access_attempt / reserve_theme_gen_quota / reserve_ai_picks_quota) -
-- שסוגרות מרוצי בדיקה-ואז-כתיבה (TOCTOU) בין בקשות מקבילות על אותה שורת
-- client/photographer - פשוט מריצים מחדש את שלוש ה-create or replace function
-- למעלה על פרויקט Supabase שכבר קיים (create or replace הוא idempotent,
-- לא צריך drop קודם); אין טריגר/עמודה חדשה שדורשת migration נפרדת כאן.

-- אם כבר הרצת גרסה קודמת בלי "עיצוב הגלריה עם AI" (עיצוב מותאם אישית ומונה
-- שימוש יומי, app/api/photographer/design-theme), מריצים גם את זה - חייב לרוץ
-- לפני הבלוק של protect_ai_usage_counters למטה, שמפנה לעמודות האלה:
-- alter table photographers add column if not exists custom_theme jsonb;
-- alter table photographers add column if not exists theme_gen_count int default 0 not null;
-- alter table photographers add column if not exists theme_gen_date date;

-- אם כבר הרצת גרסה קודמת של הסכמה בלי ה-with check על "photographers see own
-- row" ובלי ההגנה על insert/מוני ה-AI (הפגיעות: צלמת מחוברת יכלה למחוק את
-- השורה שלה וליצור מחדש עם is_unlimited=true, או לאפס בעצמה את ai_picks_count/
-- theme_gen_count), מריצים גם את זה על פרויקט Supabase שכבר קיים:
--
-- drop policy if exists "photographers see own row" on photographers;
-- create policy "photographers see own row" on photographers
--   for all using (auth.uid() = auth_user_id)
--   with check (auth.uid() = auth_user_id);
--
-- create or replace function protect_is_unlimited()
-- returns trigger as $$
-- begin
--   if current_setting('role', true) = 'service_role' then
--     return new;
--   end if;
--
--   if tg_op = 'INSERT' then
--     new.is_unlimited := false;
--   elsif new.is_unlimited is distinct from old.is_unlimited then
--     new.is_unlimited := old.is_unlimited;
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_protect_is_unlimited on photographers;
-- create trigger trg_protect_is_unlimited
-- before insert or update on photographers
-- for each row execute function protect_is_unlimited();
--
-- create or replace function protect_ai_usage_counters()
-- returns trigger as $$
-- begin
--   if current_setting('role', true) = 'service_role' then
--     return new;
--   end if;
--
--   if tg_op = 'INSERT' then
--     new.ai_picks_count := 0;
--     new.ai_picks_date := null;
--     new.theme_gen_count := 0;
--     new.theme_gen_date := null;
--   else
--     if new.ai_picks_count is distinct from old.ai_picks_count then
--       new.ai_picks_count := old.ai_picks_count;
--     end if;
--     if new.ai_picks_date is distinct from old.ai_picks_date then
--       new.ai_picks_date := old.ai_picks_date;
--     end if;
--     if new.theme_gen_count is distinct from old.theme_gen_count then
--       new.theme_gen_count := old.theme_gen_count;
--     end if;
--     if new.theme_gen_date is distinct from old.theme_gen_date then
--       new.theme_gen_date := old.theme_gen_date;
--     end if;
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_protect_ai_usage_counters on photographers;
-- create trigger trg_protect_ai_usage_counters
-- before insert or update on photographers
-- for each row execute function protect_ai_usage_counters();

-- אם כבר הרצת גרסה קודמת של הסכמה שבה enforce_active_gallery_limit/
-- enforce_photo_limit רצו רק על before insert (הפגיעות: צלמת מחוברת יכלה
-- לעקוף את המגבלות דרך UPDATE ישיר - להחזיר גלריה completed/expired שלה
-- לסטטוס פעיל, או להעביר gallery_id של תמונה לגלריה מלאה - וגם race
-- condition בין הכנסות מקבילות שיכול לחרוג מהמגבלה בפועל), מריצים גם את זה
-- על פרויקט Supabase שכבר קיים:
--
-- create or replace function enforce_active_gallery_limit()
-- returns trigger as $$
-- declare
--   active_count int;
--   unlimited boolean;
--   should_check boolean;
-- begin
--   if new.status in ('completed', 'expired') then
--     should_check := false;
--   elsif tg_op = 'INSERT' then
--     should_check := true;
--   else
--     should_check := old.status in ('completed', 'expired');
--   end if;
--
--   if not should_check then
--     return new;
--   end if;
--
--   select is_unlimited into unlimited from photographers where id = new.photographer_id;
--   if unlimited then
--     return new;
--   end if;
--
--   perform pg_advisory_xact_lock(hashtext(new.photographer_id::text));
--
--   select count(*) into active_count
--   from galleries
--   where photographer_id = new.photographer_id
--     and status not in ('completed', 'expired');
--
--   if active_count >= 1 then
--     raise exception 'LIMIT_ACTIVE_GALLERY: חשבון חינמי מוגבל לגלריה פעילה אחת - השלימי או מחקי גלריה קיימת כדי ליצור חדשה';
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_enforce_active_gallery_limit on galleries;
-- create trigger trg_enforce_active_gallery_limit
-- before insert or update on galleries
-- for each row execute function enforce_active_gallery_limit();
--
-- create or replace function enforce_photo_limit()
-- returns trigger as $$
-- declare
--   photo_count int;
--   unlimited boolean;
--   should_check boolean;
-- begin
--   if tg_op = 'INSERT' then
--     should_check := true;
--   else
--     should_check := new.gallery_id is distinct from old.gallery_id;
--   end if;
--
--   if not should_check then
--     return new;
--   end if;
--
--   select p.is_unlimited into unlimited
--   from galleries g join photographers p on p.id = g.photographer_id
--   where g.id = new.gallery_id;
--
--   if unlimited then
--     return new;
--   end if;
--
--   perform pg_advisory_xact_lock(hashtext(new.gallery_id::text));
--
--   select count(*) into photo_count
--   from photos
--   where gallery_id = new.gallery_id;
--
--   if photo_count >= 25 then
--     raise exception 'LIMIT_PHOTOS: חשבון חינמי מוגבל ל-25 תמונות בגלריה';
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_enforce_photo_limit on photos;
-- create trigger trg_enforce_photo_limit
-- before insert or update on photos
-- for each row execute function enforce_photo_limit();

-- Storage: bucket לתמונות הגלריה
--
-- *** עבר ל-Cloudflare R2 (ראו lib/r2.ts) - ה-bucket וה-policies למטה כבר
-- *** לא מקבלים קריאה/כתיבה בפועל מהאפליקציה. משאירים אותם כאן בכוונה (לא
-- *** מוחקים) - נתונים ישנים עדיין יושבים ב-bucket הזה (לא הועברו, הוחלט
-- *** שהם חד-פעמיים/disposable) והמדיניות לא מזיקה במצב רדום. אם/כשמנקים את
-- *** ה-bucket הישן ידנית בעתיד, אפשר גם להסיר את השורות האלה.
--
-- מריצים את זה, או יוצרים ידנית ב-Dashboard > Storage > New bucket (שם: gallery-photos, פרטי!)
insert into storage.buckets (id, name, public)
values ('gallery-photos', 'gallery-photos', false)
on conflict (id) do update set public = false;

-- ה-bucket פרטי במכוון: אין policy שמאפשרת קריאה ישירה (לא ל-anon ולא ל-authenticated).
-- הצפייה בתמונות (גם של הלקוחה בגלריה) קורית אך ורק דרך signed URL זמני שנוצר
-- בצד שרת עם service_role key, אחרי אימות session - ראו app/api/gallery/[id]/route.ts.
-- זה נותן שליטה אמיתית על תוקף הגישה (לא כמו bucket ציבורי, שאין לו "פקיעת תוקף").
-- (הערה: זה תיאור היסטורי - הצפייה בפועל עברה ל-signed URL של R2, ראו למעלה.)

-- רק צלמים מחוברים יכולים להעלות, ורק לתוך תיקיית גלריה ששייכת להם
-- (הנתיב בבאקט הוא bucket/{galleryId}/... ולכן בודקים ש-galleryId שייך לצלם המחובר)
create policy "photographers upload only to own galleries" on storage.objects
  for insert with check (
    bucket_id = 'gallery-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
  );

-- שתי ה-policies הבאות (select/delete) היו חסרות עד עכשיו - היה policy יחיד
-- ל-insert בלבד. המשמעות בפועל: מחיקת גלריה (app/api/galleries/[id]/route.ts,
-- DELETE) קוראת ל-storage.list()/.remove() עם ה-session client (לא service key),
-- ובלי policy מתאים ה-RLS חסם את זה בשקט - מחיקת גלריה מעולם לא באמת מחקה
-- קבצים מה-Storage, רק את רשומות ה-DB (דרך ה-CASCADE). אותו policy דרוש גם
-- כדי שהצלמת תוכל למחוק תמונות סופיות בודדות שהיא העלתה (delivered_photos,
-- ראו app/dashboard/galleries/[id]/edit/page.tsx) - אותו תנאי בעלות בדיוק כמו
-- ה-insert policy למעלה, רק for select/for delete.
create policy "photographers read own gallery files" on storage.objects
  for select using (
    bucket_id = 'gallery-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
  );

create policy "photographers delete own gallery files" on storage.objects
  for delete using (
    bucket_id = 'gallery-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from galleries where photographer_id in (
        select id from photographers where auth_user_id = auth.uid()
      )
    )
  );

-- אם כבר הרצת גרסה קודמת של הסכמה עם bucket ציבורי, מריצים גם את זה כדי לנקות:
-- update storage.buckets set public = false where id = 'gallery-photos';
-- drop policy if exists "public read gallery photos" on storage.objects;

-- Storage: bucket ללוגו של הצלמת (מוצג ללקוחה במסך הפתיחה של הגלריה, ראו
-- app/dashboard/settings/page.tsx ו-app/gallery/[id]/page.tsx). בכוונה ציבורי,
-- בניגוד ל-gallery-photos - לוגו הוא נכס מיתוג, לא תוכן פרטי של לקוחה, ואין
-- טעם לייצר signed URL מחדש בכל טעינה בשביל תמונה קטנה וקבועה.
insert into storage.buckets (id, name, public)
values ('photographer-logos', 'photographer-logos', true)
on conflict (id) do update set public = true;

-- נתיב קבוע {photographerId}/logo (בלי סיומת - content-type נקבע מה-upload
-- עצמו, לא מהנתיב) עם upsert בצד הקליינט: כל העלאה חדשה דורסת את הקודמת,
-- כדי שלא ייצברו קבצי לוגו ישנים יתומים.
create policy "photographers upload own logo" on storage.objects
  for insert with check (
    bucket_id = 'photographer-logos'
    and (storage.foldername(name))[1]::uuid in (
      select id from photographers where auth_user_id = auth.uid()
    )
  );

create policy "photographers update own logo" on storage.objects
  for update using (
    bucket_id = 'photographer-logos'
    and (storage.foldername(name))[1]::uuid in (
      select id from photographers where auth_user_id = auth.uid()
    )
  );

-- ===== קריאת לוגו: בלי policy ציבורי של select =====
-- היה כאן "public read logos" (for select לכולם) - מיותר לגמרי לתצוגה, כי
-- ב-bucket ציבורי ה-URL הציבורי (getPublicUrl) לא עובר דרך RLS בכלל, אבל הוא
-- אפשר לכל אחד לקרוא list() על ה-bucket ולמפות את כל תיקיות הצלמות. במקומו
-- select רק על התיקייה של הצלמת עצמה - נדרש כי upload עם upsert: true
-- (app/dashboard/settings/page.tsx) צריך גם הרשאת select על האובייקט הקיים.
drop policy if exists "public read logos" on storage.objects;
drop policy if exists "photographers read own logo" on storage.objects;
create policy "photographers read own logo" on storage.objects
  for select using (
    bucket_id = 'photographer-logos'
    and (storage.foldername(name))[1]::uuid in (
      select id from photographers where auth_user_id = auth.uid()
    )
  );
-- ===== סוף קריאת לוגו =====

-- אם כבר הרצת גרסה קודמת של הסכמה בלי מסירת תמונות ערוכות בתוך האפליקציה
-- (delivered_photos, הטריגר mark_gallery_delivered, ו-policies select/delete
-- ל-gallery-photos - האחרונות מתקנות גם באג קיים: מחיקת גלריה מעולם לא באמת
-- מחקה קבצים מה-Storage כי היה policy יחיד ל-insert בלבד), מריצים גם את זה
-- על פרויקט Supabase שכבר קיים:
--
-- create table if not exists delivered_photos (
--   id uuid primary key default uuid_generate_v4(),
--   gallery_id uuid references galleries(id) on delete cascade not null,
--   file_path text not null,
--   original_filename text not null,
--   created_at timestamptz default now()
-- );
-- create index if not exists idx_delivered_photos_gallery on delivered_photos(gallery_id);
-- alter table delivered_photos enable row level security;
-- drop policy if exists "photographers see own delivered photos" on delivered_photos;
-- create policy "photographers see own delivered photos" on delivered_photos
--   for all using (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ));
--
-- create or replace function mark_gallery_delivered()
-- returns trigger as $$
-- begin
--   update galleries set delivered_at = coalesce(delivered_at, now()) where id = new.gallery_id;
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_delivered_photos_mark_delivered on delivered_photos;
-- create trigger trg_delivered_photos_mark_delivered
-- after insert on delivered_photos
-- for each row execute function mark_gallery_delivered();
--
-- drop policy if exists "photographers read own gallery files" on storage.objects;
-- create policy "photographers read own gallery files" on storage.objects
--   for select using (
--     bucket_id = 'gallery-photos'
--     and (storage.foldername(name))[1]::uuid in (
--       select id from galleries where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     )
--   );
--
-- drop policy if exists "photographers delete own gallery files" on storage.objects;
-- create policy "photographers delete own gallery files" on storage.objects
--   for delete using (
--     bucket_id = 'gallery-photos'
--     and (storage.foldername(name))[1]::uuid in (
--       select id from galleries where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     )
--   );

-- אם כבר הרצת גרסה קודמת של הסכמה בלי מחיקה אוטומטית של תמונות מקור אחרי
-- מסירה (app/api/cron/tick/route.ts, שלב 3), מריצים גם את זה:
-- alter table galleries add column if not exists originals_cleaned_up_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי התראת מייל לצלמת לפני מחיקת המקור
-- (app/api/cron/tick/route.ts, שלב 3), מריצים גם את זה:
-- alter table galleries add column if not exists originals_deletion_warning_sent_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי תגובת צלמת להערת לקוחה, מריצים גם את זה:
-- alter table selections add column if not exists photographer_reply text;
-- alter table selections add column if not exists photographer_reply_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי מעקב מעבר אחסון ל-Cloudflare R2
-- (קוד המיגרציה הוסר מאז), מריצים גם את זה:
-- alter table photos add column if not exists file_migrated_at timestamptz;
-- alter table photos add column if not exists thumbnail_migrated_at timestamptz;
-- alter table delivered_photos add column if not exists file_migrated_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי אפשרות לכתובות מייל נוספות להזמנה (למשל בני
-- משפחה), מריצים גם את זה:
-- alter table galleries add column if not exists additional_invite_emails text[];

-- אם כבר הרצת גרסה קודמת בלי פתיחה מחדש של בחירה (אחרי שהלקוחה סיימה
-- לבחור), מריצים גם את זה:
-- alter table galleries add column if not exists reopened_for_selection_at timestamptz;

-- אם כבר הרצת גרסה קודמת בלי מעקב תשלומים עם סכומים (סכום לתשלום + רשימת
-- תשלומים שהתקבלו, ראו lib/payments.ts), מריצים גם את זה:
-- alter table galleries add column if not exists amount_due_override numeric(10,2) check (amount_due_override is null or amount_due_override >= 0);
-- create table if not exists gallery_payments (
--   id uuid primary key default uuid_generate_v4(),
--   gallery_id uuid references galleries(id) on delete cascade not null,
--   amount numeric(10,2) not null check (amount > 0),
--   paid_on date not null default current_date,
--   method text,
--   note text,
--   created_at timestamptz default now()
-- );
-- create index if not exists idx_gallery_payments_gallery on gallery_payments(gallery_id);
-- alter table gallery_payments enable row level security;
-- drop policy if exists "photographers see own gallery payments" on gallery_payments;
-- create policy "photographers see own gallery payments" on gallery_payments
--   for all using (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ))
--   with check (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ));

-- אם כבר הרצת גרסה קודמת בלי יומן צילומים (shoots, תזכורות לפני צילום וסיכום
-- יומי לצלמת - app/dashboard/calendar, app/api/shoots, app/api/cron/tick), מריצים גם את זה:
-- alter table photographers add column if not exists shoot_reminder_days int default 1 not null;
-- alter table photographers add column if not exists shoot_daily_summary_enabled boolean default true not null;
-- alter table photographers add column if not exists shoot_summary_sent_on date;
-- create table if not exists shoots (
--   id uuid primary key default uuid_generate_v4(),
--   photographer_id uuid references photographers(id) on delete cascade not null,
--   client_id uuid references clients(id) on delete cascade not null,
--   gallery_id uuid references galleries(id) on delete set null,
--   shoot_date date not null,
--   start_time time not null,
--   location text not null,
--   notes text,
--   confirmation_sent_at timestamptz,
--   reminder_sent_at timestamptz,
--   created_at timestamptz default now()
-- );
-- create index if not exists idx_shoots_photographer_date on shoots(photographer_id, shoot_date);
-- create index if not exists idx_shoots_date on shoots(shoot_date);
-- alter table shoots enable row level security;
-- drop policy if exists "photographers see own shoots" on shoots;
-- create policy "photographers see own shoots" on shoots
--   for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
--   with check (
--     photographer_id in (select id from photographers where auth_user_id = auth.uid())
--     and client_id in (
--       select id from clients where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     )
--     and (gallery_id is null or gallery_id in (
--       select id from galleries where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     ))
--   );

-- אם כבר הרצת גרסה קודמת בלי "תמונת מתנה" (lib/gifts.ts), מריצים גם את זה:
-- alter table photos add column if not exists is_gift boolean default false not null;
-- alter table photos add column if not exists gift_message text check (gift_message is null or char_length(gift_message) <= 200);
-- create index if not exists idx_photos_gallery_gift on photos(gallery_id) where is_gift;


-- אם כבר הרצת גרסה קודמת שבה גלריה שנפתחה מחדש לבחירה (reopened_for_selection_at)
-- לא נספרה במגבלת הגלריה הפעילה של חשבון חינמי, מריצים גם את זה:
-- create or replace function enforce_active_gallery_limit()
-- returns trigger as $$
-- declare
--   active_count int;
--   unlimited boolean;
--   new_active boolean;
--   should_check boolean;
-- begin
--   -- "פעילה" = עדיין בבחירה (status לא completed/expired) או שהצלמת פתחה
--   -- אותה מחדש לבחירה (reopened_for_selection_at) - מבחינת הלקוחה זו גלריה
--   -- פעילה לכל דבר, ובלי זה פתיחה מחדש (גם ישירות מהדפדפן דרך ה-RLS) עקפה
--   -- את המגבלה.
--   new_active := new.status not in ('completed', 'expired') or new.reopened_for_selection_at is not null;
--
--   if not new_active then
--     should_check := false;
--   elsif tg_op = 'INSERT' then
--     should_check := true;
--   else
--     should_check := not (old.status not in ('completed', 'expired') or old.reopened_for_selection_at is not null);
--   end if;
--
--   if not should_check then
--     return new;
--   end if;
--
--   select is_unlimited into unlimited from photographers where id = new.photographer_id;
--   if unlimited then
--     return new;
--   end if;
--
--   -- מנעול advisory בתוך הטרנזקציה (לפי photographer_id), לפני הספירה: בלי זה
--   -- שתי הכנסות/עדכונים מקבילים על אותה צלמת יכולים לקרוא את אותה ספירה
--   -- "לפני" ולעבור את הבדיקה שניהם (race condition קלאסי - TOCTOU), ולחרוג
--   -- בפועל ממגבלת גלריה פעילה אחת. המנעול משתחרר אוטומטית בסוף הטרנזקציה,
--   -- אין row ממשי לנעול כי הספירה נגזרת (derived) ולא שורה בודדת.
--   perform pg_advisory_xact_lock(hashtext(new.photographer_id::text));
--
--   select count(*) into active_count
--   from galleries
--   where photographer_id = new.photographer_id
--     and id <> new.id
--     and (status not in ('completed', 'expired') or reopened_for_selection_at is not null);
--
--   if active_count >= 1 then
--     raise exception 'LIMIT_ACTIVE_GALLERY: חשבון חינמי מוגבל לגלריה פעילה אחת - השלימי או מחקי גלריה קיימת כדי ליצור חדשה';
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_enforce_active_gallery_limit on galleries;
-- create trigger trg_enforce_active_gallery_limit
-- before insert or update on galleries
-- for each row execute function enforce_active_gallery_limit();

-- ===== הקשחת אבטחה ושלמות נתונים (תיקוני ביקורת) =====
-- אם כבר הרצת גרסה קודמת של הסכמה בלי: דילוג על תגובת צלמת בטריגר הפעילות,
-- with check חוצה-דיירים על galleries/selections, on delete cascade על
-- auth_user_id, אינדקסי FK, ביטול select ציבורי על לוגו, policy מפוצל על
-- photographers, הגנה על מעברי סטטוס של galleries, הגנה על
-- shoot_summary_sent_on והרשאות execute לפונקציות האטומיות - מריצים גם את זה
-- על פרויקט Supabase שכבר קיים (הכול idempotent, אפשר להריץ שוב):
--
-- 2. trg_selections_activity מדלג על תגובת צלמת בלבד
-- create or replace function update_gallery_last_activity()
-- returns trigger as $$
-- begin
--   if tg_op = 'UPDATE'
--      and (to_jsonb(new) - 'photographer_reply' - 'photographer_reply_at')
--          = (to_jsonb(old) - 'photographer_reply' - 'photographer_reply_at') then
--     return new;
--   end if;
--
--   update galleries
--   set last_activity_at = now(),
--       status = case when status in ('draft', 'sent') then 'in_progress' else status end
--   where id = coalesce(new.gallery_id, old.gallery_id);
--   return coalesce(new, old);
-- end;
-- $$ language plpgsql;
--
-- 3. with check חוצה-דיירים על galleries/selections
-- create or replace function public.participant_belongs_to_gallery(p_participant_id uuid, p_gallery_id uuid)
-- returns boolean as $$
--   select exists (
--     select 1 from public.gallery_participants
--     where id = p_participant_id and gallery_id = p_gallery_id
--   );
-- $$ language sql stable security definer set search_path = public;
--
-- drop policy if exists "photographers see own galleries" on galleries;
-- create policy "photographers see own galleries" on galleries
--   for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
--   with check (
--     photographer_id in (select id from photographers where auth_user_id = auth.uid())
--     and client_id in (
--       select id from clients where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     )
--     and (owner_participant_id is null or public.participant_belongs_to_gallery(owner_participant_id, id))
--   );
--
-- drop policy if exists "photographers see own selections" on selections;
-- create policy "photographers see own selections" on selections
--   for all using (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ))
--   with check (
--     gallery_id in (
--       select id from galleries where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     )
--     and photo_id in (select p.id from photos p where p.gallery_id = selections.gallery_id)
--     and participant_id in (select gp.id from gallery_participants gp where gp.gallery_id = selections.gallery_id)
--   );
--
-- 4. photographers.auth_user_id -> on delete cascade
-- alter table photographers drop constraint if exists photographers_auth_user_id_fkey;
-- alter table photographers add constraint photographers_auth_user_id_fkey
--   foreign key (auth_user_id) references auth.users(id) on delete cascade;
--
-- 5. אינדקסים חסרים על FK
-- create index if not exists idx_selections_photo on selections(photo_id);
-- create index if not exists idx_selections_participant on selections(participant_id);
-- create index if not exists idx_galleries_client on galleries(client_id);
-- create index if not exists idx_shoots_client on shoots(client_id);
-- create index if not exists idx_shoots_gallery on shoots(gallery_id);
-- create index if not exists idx_sync_jobs_gallery on sync_jobs(gallery_id);
--
-- 6. לוגו: בלי select ציבורי (רק התיקייה של הצלמת עצמה, בשביל upsert)
-- drop policy if exists "public read logos" on storage.objects;
-- drop policy if exists "photographers read own logo" on storage.objects;
-- create policy "photographers read own logo" on storage.objects
--   for select using (
--     bucket_id = 'photographer-logos'
--     and (storage.foldername(name))[1]::uuid in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   );
--
-- 7. photographers: select + update בלבד (בלי delete/insert מה-session)
-- drop policy if exists "photographers see own row" on photographers;
-- drop policy if exists "photographers select own row" on photographers;
-- drop policy if exists "photographers update own row" on photographers;
-- create policy "photographers select own row" on photographers
--   for select using (auth.uid() = auth_user_id);
-- create policy "photographers update own row" on photographers
--   for update using (auth.uid() = auth_user_id)
--   with check (auth.uid() = auth_user_id);
--
-- 8. מעברי סטטוס של galleries - completed/expired רק מ-service_role
-- create or replace function guard_gallery_status_transitions()
-- returns trigger as $$
-- begin
--   if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
--     return new;
--   end if;
--
--   if tg_op = 'INSERT' then
--     if new.status is null or new.status not in ('draft', 'sent') then
--       raise exception 'GALLERY_STATUS_FORBIDDEN: גלריה חדשה יכולה להיווצר רק בסטטוס draft או sent';
--     end if;
--     if new.reopened_for_selection_at is not null then
--       raise exception 'GALLERY_STATUS_FORBIDDEN: אי אפשר להגדיר reopened_for_selection_at ביצירת גלריה';
--     end if;
--   elsif new.status is distinct from old.status and new.status in ('completed', 'expired') then
--     raise exception 'GALLERY_STATUS_FORBIDDEN: מעבר לסטטוס completed/expired מותר רק מצד השרת';
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_guard_gallery_status_transitions on galleries;
-- create trigger trg_guard_gallery_status_transitions
-- before insert or update on galleries
-- for each row execute function guard_gallery_status_transitions();
--
-- 9. shoot_summary_sent_on - כתיבה רק מ-service_role
-- create or replace function protect_internal_photographer_columns()
-- returns trigger as $$
-- begin
--   if current_setting('role', true) = 'service_role' then
--     return new;
--   end if;
--
--   if tg_op = 'INSERT' then
--     new.shoot_summary_sent_on := null;
--   elsif new.shoot_summary_sent_on is distinct from old.shoot_summary_sent_on then
--     new.shoot_summary_sent_on := old.shoot_summary_sent_on;
--   end if;
--
--   return new;
-- end;
-- $$ language plpgsql;
--
-- drop trigger if exists trg_protect_internal_photographer_columns on photographers;
-- create trigger trg_protect_internal_photographer_columns
-- before insert or update on photographers
-- for each row execute function protect_internal_photographer_columns();
--
-- 10. פונקציות אטומיות - execute רק ל-service_role
-- revoke execute on function register_failed_access_attempt(uuid) from public, anon, authenticated;
-- revoke execute on function reserve_theme_gen_quota(uuid, int) from public, anon, authenticated;
-- revoke execute on function reserve_ai_picks_quota(uuid, int) from public, anon, authenticated;
-- grant execute on function register_failed_access_attempt(uuid) to service_role;
-- grant execute on function reserve_theme_gen_quota(uuid, int) to service_role;
-- grant execute on function reserve_ai_picks_quota(uuid, int) to service_role;
-- ===== סוף הקשחת אבטחה ושלמות נתונים =====

-- אם כבר הרצת גרסה קודמת בלי אימות נתיבי הקבצים (file_path/thumbnail_path חייבים
-- להתחיל ב-{gallery_id}/ - ה-RLS על photos בודק רק gallery_id), מריצים גם את זה.
-- NOT VALID: נאכף על כל insert/update מעכשיו, בלי לבדוק שורות קיימות (כדי שהמיגרציה
-- לא תיכשל על שורה ישנה). אפשר לבדוק גם את הקיימות אחר כך עם VALIDATE CONSTRAINT.
-- alter table photos drop constraint if exists photos_paths_in_gallery;
-- alter table photos add constraint photos_paths_in_gallery check (
--   starts_with(file_path, gallery_id::text || '/')
--   and (thumbnail_path is null or starts_with(thumbnail_path, gallery_id::text || '/'))
-- ) not valid;
-- alter table delivered_photos drop constraint if exists delivered_photos_path_in_gallery;
-- alter table delivered_photos add constraint delivered_photos_path_in_gallery
--   check (starts_with(file_path, gallery_id::text || '/')) not valid;
-- (אופציונלי, אחרי שבדקת שאין שורות חריגות:)
-- alter table photos validate constraint photos_paths_in_gallery;
-- alter table delivered_photos validate constraint delivered_photos_path_in_gallery;

-- ===== מיגרציה: API גלריית הלקוחה (תפוגה/נעילה/מכסה/צפיות) =====
-- להריץ פעם אחת על פרויקט קיים (הכל idempotent):
-- alter table galleries add column if not exists quota_notified_at timestamptz;
--
-- create or replace function register_failed_access_attempt(p_client_id uuid)
-- returns table (already_locked_out boolean, failed_attempts int, locked_until timestamptz) as $$
-- declare
--   current_attempts int;
--   current_locked_until timestamptz;
--   new_attempts int;
--   new_locked_until timestamptz;
-- begin
--   select c.failed_access_attempts, c.locked_until
--   into current_attempts, current_locked_until
--   from clients c
--   where c.id = p_client_id
--   for update;
--
--   if not found then
--     return query select false, 0, null::timestamptz;
--     return;
--   end if;
--
--   if current_locked_until is not null and current_locked_until > now() then
--     return query select true, coalesce(current_attempts, 0), current_locked_until;
--     return;
--   end if;
--
--   if current_locked_until is not null and current_locked_until <= now() then
--     current_attempts := 0;
--   end if;
--
--   new_attempts := coalesce(current_attempts, 0) + 1;
--   if new_attempts >= 5 then
--     new_locked_until := now() + interval '15 minutes';
--   else
--     new_locked_until := null;
--   end if;
--
--   update clients
--   set failed_access_attempts = new_attempts,
--       locked_until = new_locked_until
--   where id = p_client_id;
--
--   return query select false, new_attempts, new_locked_until;
-- end;
-- $$ language plpgsql;
--
-- create or replace function release_ai_picks_quota(p_photographer_id uuid)
-- returns void as $$
--   update photographers
--   set ai_picks_count = ai_picks_count - 1
--   where id = p_photographer_id
--     and ai_picks_date = current_date
--     and ai_picks_count > 0;
-- $$ language sql;
--
-- create or replace function increment_gallery_view_count(p_gallery_id uuid)
-- returns void as $$
--   update galleries
--   set view_count = view_count + 1,
--       last_viewed_at = now()
--   where id = p_gallery_id;
-- $$ language sql;
--
-- revoke execute on function release_ai_picks_quota(uuid) from public, anon, authenticated;
-- revoke execute on function increment_gallery_view_count(uuid) from public, anon, authenticated;
-- grant execute on function release_ai_picks_quota(uuid) to service_role;
-- grant execute on function increment_gallery_view_count(uuid) to service_role;
-- ===== סוף מיגרציה: API גלריית הלקוחה =====

-- ===== מיגרציה: גורם אימות שני ל"זאת אני" (בעלת הגלריה) =====
-- אם כבר הרצת גרסה קודמת בלי אימות המייל של הלקוחה הרשומה ב-"זאת אני"
-- (app/api/gallery/[id]/identify/route.ts), מריצים גם את זה (הכל idempotent).
-- בלי המיגרציה הזו אי אפשר להיכנס כבעלים מדפדפן חדש (השרת מחזיר 503), אבל
-- כניסה כאורחת ודפדפנים שכבר מזוהים כבעלים ממשיכים לעבוד.
-- alter table clients add column if not exists owner_claim_failed_attempts int default 0;
-- alter table clients add column if not exists owner_claim_locked_until timestamptz;
--
-- create or replace function register_failed_owner_claim(p_client_id uuid)
-- returns table (already_locked_out boolean, failed_attempts int, locked_until timestamptz) as $$
-- declare
--   current_attempts int;
--   current_locked_until timestamptz;
--   new_attempts int;
--   new_locked_until timestamptz;
-- begin
--   select c.owner_claim_failed_attempts, c.owner_claim_locked_until
--   into current_attempts, current_locked_until
--   from clients c
--   where c.id = p_client_id
--   for update;
--
--   if not found then
--     return query select false, 0, null::timestamptz;
--     return;
--   end if;
--
--   if current_locked_until is not null and current_locked_until > now() then
--     return query select true, coalesce(current_attempts, 0), current_locked_until;
--     return;
--   end if;
--
--   if current_locked_until is not null and current_locked_until <= now() then
--     current_attempts := 0;
--   end if;
--
--   new_attempts := coalesce(current_attempts, 0) + 1;
--   if new_attempts >= 5 then
--     new_locked_until := now() + interval '15 minutes';
--   else
--     new_locked_until := null;
--   end if;
--
--   update clients
--   set owner_claim_failed_attempts = new_attempts,
--       owner_claim_locked_until = new_locked_until
--   where id = p_client_id;
--
--   return query select false, new_attempts, new_locked_until;
-- end;
-- $$ language plpgsql;
--
-- revoke execute on function register_failed_owner_claim(uuid) from public, anon, authenticated;
-- grant execute on function register_failed_owner_claim(uuid) to service_role;
-- ===== סוף מיגרציה: גורם אימות שני ל"זאת אני" =====

-- ===== מיגרציה: מגבלת קצב למיילים ידניים (manual_email_sends) =====
-- להריץ פעם אחת על פרויקט קיים (הכל idempotent). עד שמריצים - הקוד לא נשבר:
-- השליחה ממשיכה לעבוד, ומגבלת 60 השניות חלה רק על תזכורת תפוגה ועדכון צילום
-- (לפי last_reminder_sent_at / confirmation_sent_at הקיימות).
-- create table if not exists manual_email_sends (
--   id uuid primary key default uuid_generate_v4(),
--   photographer_id uuid references photographers(id) on delete cascade not null,
--   gallery_id uuid references galleries(id) on delete cascade,
--   shoot_id uuid references shoots(id) on delete cascade,
--   email_type text not null check (email_type in ('invite', 'reminder', 'delivery', 'review', 'shoot_update')),
--   sent_at timestamptz default now() not null,
--   check (gallery_id is not null or shoot_id is not null)
-- );
-- create index if not exists idx_manual_email_sends_gallery on manual_email_sends(gallery_id, email_type, sent_at) where gallery_id is not null;
-- create index if not exists idx_manual_email_sends_shoot on manual_email_sends(shoot_id, email_type, sent_at) where shoot_id is not null;
-- create index if not exists idx_manual_email_sends_photographer on manual_email_sends(photographer_id);
-- alter table manual_email_sends enable row level security;
-- drop policy if exists "photographers manage own manual email sends" on manual_email_sends;
-- create policy "photographers manage own manual email sends" on manual_email_sends
--   for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
--   with check (
--     photographer_id in (select id from photographers where auth_user_id = auth.uid())
--     and (gallery_id is null or gallery_id in (
--       select id from galleries where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     ))
--     and (shoot_id is null or shoot_id in (
--       select id from shoots where photographer_id in (
--         select id from photographers where auth_user_id = auth.uid()
--       )
--     ))
--   );
-- ===== סוף מיגרציה: מגבלת קצב למיילים ידניים =====

-- ===== מיגרציה: בקשות הארכה לתקופת הבחירה (gallery_extension_requests) =====
-- להריץ פעם אחת על פרויקט קיים (הכל idempotent). עד שמריצים - הקוד לא נשבר:
-- כפתור "לבקש הארכה" פשוט לא מוצג ללקוחה, ואזור הבקשות לא מוצג בדף העריכה.
-- create table if not exists gallery_extension_requests (
--   id uuid primary key default uuid_generate_v4(),
--   gallery_id uuid references galleries(id) on delete cascade not null,
--   participant_id uuid references gallery_participants(id) on delete set null,
--   requested_days int not null check (requested_days between 1 and 7),
--   status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
--   created_at timestamptz default now() not null,
--   decided_at timestamptz
-- );
-- create index if not exists idx_gallery_extension_requests_gallery on gallery_extension_requests(gallery_id);
-- create unique index if not exists gallery_extension_requests_one_pending on gallery_extension_requests(gallery_id) where status = 'pending';
-- alter table gallery_extension_requests enable row level security;
-- drop policy if exists "photographers select own extension requests" on gallery_extension_requests;
-- create policy "photographers select own extension requests" on gallery_extension_requests
--   for select using (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ));
-- drop policy if exists "photographers update own extension requests" on gallery_extension_requests;
-- create policy "photographers update own extension requests" on gallery_extension_requests
--   for update using (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ))
--   with check (gallery_id in (
--     select id from galleries where photographer_id in (
--       select id from photographers where auth_user_id = auth.uid()
--     )
--   ));
-- ===== סוף מיגרציה: בקשות הארכה לתקופת הבחירה =====

-- ===== מיגרציה: לשון פנייה ללקוח/ה ולאורחים (client_gender / gender) =====
-- להריץ פעם אחת על פרויקט קיים (הכל idempotent). עד שמריצים - הקוד לא נשבר:
-- הלקוח/ה הראשי/ת נחשב/ת נקבה ('f'), אורחים - פנייה ניטרלית, והבחירה בטפסים
-- פשוט לא נשמרת (ראו lib/gender.ts).
-- alter table galleries add column if not exists client_gender text default 'f' not null;
-- alter table galleries drop constraint if exists galleries_client_gender_check;
-- alter table galleries add constraint galleries_client_gender_check check (client_gender in ('f', 'm'));
-- alter table gallery_participants add column if not exists gender text;
-- alter table gallery_participants drop constraint if exists gallery_participants_gender_check;
-- alter table gallery_participants add constraint gallery_participants_gender_check check (gender in ('f', 'm'));
-- notify pgrst, 'reload schema';
-- ===== סוף מיגרציה: לשון פנייה =====
