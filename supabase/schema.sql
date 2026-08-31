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
  selected_at timestamptz default now(),
  unique (gallery_id, photo_id, participant_id)
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

create policy "photographers see own row" on photographers
  for all using (auth.uid() = auth_user_id);

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
create or replace function enforce_active_gallery_limit()
returns trigger as $$
declare
  active_count int;
begin
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
before insert on galleries
for each row execute function enforce_active_gallery_limit();

create or replace function enforce_photo_limit()
returns trigger as $$
declare
  photo_count int;
begin
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
before insert on photos
for each row execute function enforce_photo_limit();

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

-- אם כבר הרצת גרסה קודמת של הסכמה עם bucket ציבורי, מריצים גם את זה כדי לנקות:
-- update storage.buckets set public = false where id = 'gallery-photos';
-- drop policy if exists "public read gallery photos" on storage.objects;
