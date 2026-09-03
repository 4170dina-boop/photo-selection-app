-- סכמת מסד נתונים למערכת בחירת תמונות
-- Multi-tenant מההתחלה: כל רשומה מקושרת (ישירות או בעקיפין) ל-photographer

create extension if not exists "uuid-ossp";

create table photographers (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) unique,
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
  -- מתי הצלמת התחילה לערוך את התמונות שנבחרו - שלב ביניים נפרד גם מ-status
  -- ('completed' אומר רק שהלקוחה סיימה לבחור) וגם מ-delivered_at (מסירת
  -- הקבצים הסופיים בפועל). null = טרם התחילה עריכה.
  editing_started_at timestamptz,
  -- מתי הצלמת סימנה שהתמונות הסופיות נמסרו בפועל ללקוחה (לא אוטומטי - "הושלם"
  -- רק אומר שהלקוחה סיימה לבחור, לא שהתמונות המוגמרות כבר יצאו). null = טרם נמסר.
  delivered_at timestamptz,
  -- מתי הצלמת סימנה שהתשלום התקבל - עצמאי לגמרי מהסטטוס/מסירה (בדרך כלל
  -- משולם בהזמנה, הרבה לפני שהלקוחה סיימה לבחור). אין אינטגרציית סליקה
  -- (ראו README) אז זה סימון ידני בלבד, לא נגזר מכלום אוטומטית. null = טרם שולם.
  paid_at timestamptz,
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
  created_at timestamptz default now()
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
  created_at timestamptz default now()
);
create index idx_delivered_photos_gallery on delivered_photos(gallery_id);
alter table delivered_photos enable row level security;
create policy "photographers see own delivered photos" on delivered_photos
  for all using (gallery_id in (
    select id from galleries where photographer_id in (
      select id from photographers where auth_user_id = auth.uid()
    )
  ));

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

-- אינדקסים בסיסיים לביצועים
create index idx_clients_photographer on clients(photographer_id);
create index idx_galleries_photographer on galleries(photographer_id);
create index idx_photos_gallery on photos(gallery_id);
create index idx_selections_gallery on selections(gallery_id);
create index idx_gallery_participants_gallery on gallery_participants(gallery_id);

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
create policy "photographers see own row" on photographers
  for all using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

create policy "photographers see own clients" on clients
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()));

create policy "photographers see own galleries" on galleries
  for all using (photographer_id in (select id from photographers where auth_user_id = auth.uid()));

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
  ));

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
-- insert של גלריה לא-completed/expired, או update שהופך גלריה completed/
-- expired ללא-כזו - כדי לא להריץ את הבדיקה בכל update רגיל של גלריה שכבר
-- פעילה (למשל מעבר sent -> in_progress בכל כניסה של לקוחה, ראו
-- app/api/gallery/[id]/route.ts).
create or replace function enforce_active_gallery_limit()
returns trigger as $$
declare
  active_count int;
  unlimited boolean;
  should_check boolean;
begin
  if new.status in ('completed', 'expired') then
    should_check := false;
  elsif tg_op = 'INSERT' then
    should_check := true;
  else
    should_check := old.status in ('completed', 'expired');
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
    and status not in ('completed', 'expired');

  if active_count >= 1 then
    raise exception 'LIMIT_ACTIVE_GALLERY: חשבון חינמי מוגבל לגלריה פעילה אחת - השלימי או מחקי גלריה קיימת כדי ליצור חדשה';
  end if;

  return new;
end;
$$ language plpgsql;

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

-- אותה בעיה בדיוק (read-then-write על מונה ב-JS, בלי נעילה), אבל על מוני
-- השימוש היומיים ב-AI (theme_gen_count/date ב-app/api/photographer/design-theme,
-- ai_picks_count/date ב-app/api/gallery/[id]/ai-picks) - שם המרוץ הוא בין
-- לשוניות/בני משפחה שלוחצים כמעט יחד, וההשפעה היא עלות (קריאות Anthropic
-- בתשלום מעבר ל-DAILY_LIMIT), לא אבטחה. אותו פתרון: "reserve" אטומי אחד -
-- בדיקה + הגדלה יחד, לפני קריאת ה-AI - עם SELECT ... FOR UPDATE שנועל את
-- שורת הצלמת כדי ששתי בקשות מקבילות לא יקראו שתיהן את אותו usedToday "לפני".
-- מחזירה true אם "נתפסה" מכסה (מותר להמשיך לקרוא ל-AI), false אם המכסה
-- היומית כבר נוצלה (כולל ע"י בקשה מקבילה אחרת שזכתה קודם) - ה-route אז
-- מחזיר 429 בלי לקרוא ל-Anthropic בכלל. בכוונה לא "מחזירים" מכסה שנתפסה אם
-- קריאת ה-AI עצמה נכשלת אחר כך - מכסות יומיות רכות בלבד, וגם הקוד הקודם לא
-- זיכה ניסיון חוזר בחינם על כשל.
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

-- אם כבר הרצת גרסה קודמת של הסכמה בלי שלוש הפונקציות האטומיות למעלה
-- (register_failed_access_attempt / reserve_theme_gen_quota / reserve_ai_picks_quota) -
-- שסוגרות מרוצי בדיקה-ואז-כתיבה (TOCTOU) בין בקשות מקבילות על אותה שורת
-- client/photographer - פשוט מריצים מחדש את שלוש ה-create or replace function
-- למעלה על פרויקט Supabase שכבר קיים (create or replace הוא idempotent,
-- לא צריך drop קודם); אין טריגר/עמודה חדשה שדורשת migration נפרדת כאן.

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
-- מריצים את זה, או יוצרים ידנית ב-Dashboard > Storage > New bucket (שם: gallery-photos, פרטי!)
insert into storage.buckets (id, name, public)
values ('gallery-photos', 'gallery-photos', false)
on conflict (id) do update set public = false;

-- ה-bucket פרטי במכוון: אין policy שמאפשרת קריאה ישירה (לא ל-anon ולא ל-authenticated).
-- הצפייה בתמונות (גם של הלקוחה בגלריה) קורית אך ורק דרך signed URL זמני שנוצר
-- בצד שרת עם service_role key, אחרי אימות session - ראו app/api/gallery/[id]/route.ts.
-- זה נותן שליטה אמיתית על תוקף הגישה (לא כמו bucket ציבורי, שאין לו "פקיעת תוקף").

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

create policy "public read logos" on storage.objects
  for select using (bucket_id = 'photographer-logos');

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
