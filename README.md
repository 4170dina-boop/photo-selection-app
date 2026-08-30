# Photo Selection App — שלד פרויקט

מערכת בחירת תמונות לצלמים. שלד ראשוני לפי האפיון שסיכמנו.

## מבנה הפרויקט

```
supabase/schema.sql                          → סכמת ה-DB המלאה (טבלאות + RLS + storage bucket פרטי + auth trigger)
lib/types.ts                                 → טיפוסים (Gallery/Photo/Selection/Photographer)
lib/supabase/client.ts                       → לקוח Supabase לרכיבי 'use client' (session בעוגיות, מודע ל-auth)
lib/supabase/server.ts                       → לקוח Supabase ל-Server Components/Route Handlers
lib/session.ts                               → חתימה/אימות של session token של לקוחות גלריה (HMAC-signed)
lib/gallerySession.ts                        → עטיפה משותפת לבדיקת session בכל ה-API routes של הגלריה
middleware.ts                                → מרענן session ומגן על /dashboard/* (מפנה ל-/login אם לא מחוברים)
app/login/page.tsx                           → מסך התחברות/הרשמה לצלם (Supabase Auth)
app/login/forgot-password/page.tsx           → בקשת קישור לאיפוס סיסמה (resetPasswordForEmail)
app/login/reset-password/page.tsx            → קביעת סיסמה חדשה (updateUser, אחרי session מסוג recovery)
app/auth/callback/route.ts                   → יעד לקישור אימות המייל אחרי הרשמה, וגם לקישור איפוס הסיסמה
app/dashboard/layout.tsx                     → מעטפת לדפי הצלם (כותרת + כפתור התנתקות)
app/api/verify-access/route.ts               → אימות קוד גישה של לקוחה (צד שרת, service key) + יצירת session חתום
app/api/gallery/[id]/route.ts                → טעינת תמונות/בחירות/חבילה של הלקוחה (service key + signed URLs)
app/api/gallery/[id]/selection/route.ts      → סימון אולי/נבחר/הסרה (צד שרת, אחרי אימות session)
app/api/gallery/[id]/note/route.ts           → שמירת הערה לתמונה (צד שרת, אחרי אימות session)
app/gallery/[id]/page.tsx                     → דף הגלריה מצד הלקוחה (קוד גישה → בחירה → ספירה מול חבילה)
app/dashboard/upload/[galleryId]/page.tsx     → העלאת תמונות מצד הצלם ל-Supabase Storage
app/dashboard/galleries/page.tsx             → רשימת גלריות עם סטטוס, % התקדמות, ופעילות אחרונה (לחיצה על שורה -> העלאה, קישור נפרד לעריכה)
app/dashboard/galleries/new/page.tsx         → טופס יצירת גלריה חדשה (לקוחה + חבילה) + שליחת מייל אוטומטית ללקוחה
app/dashboard/galleries/[id]/edit/page.tsx   → עריכת פרטי לקוחה/חבילה/תוקף, ומחיקת גלריה
app/api/galleries/route.ts                   → יצירת client+gallery+package בשרת, עם session הצלם (לא service key)
app/api/galleries/[id]/route.ts              → GET/PATCH/DELETE לגלריה קיימת, עם session הצלם (לא service key)
app/api/gallery/[id]/finish/route.ts         → "סיימתי לבחור" - נועל את הגלריה (status=completed)
app/api/cron/tick/route.ts                   → מסמן גלריות שפג תוקפן + שולח תזכורות מייל (מופעל ע"י scheduler חיצוני)
lib/email.ts                                 → שליחת מייל (הזמנה לגלריה + תזכורת תפוגה) דרך Resend (no-op אם אין RESEND_API_KEY)
lib/galleryAccess.ts                         → בדיקה משותפת: אסור לערוך גלריה שהושלמה/פג תוקפה
lib/theme.ts                                 → פלטת הצבעים המשותפת (טוקנים + סגנונות input/button) - כל הדפים משתמשים בה
vercel.json                                  → תזמון Vercel Cron ל-/api/cron/tick (פעם ביום)
components/MagicButton.tsx                   → כפתור הקסם (File System Access API) + ZIP fallback, בדף העריכה של הצלמת
app/api/galleries/[id]/selected-photos/route.ts → signed URLs לתמונות שסומנו "נבחר" (לצלמת המחוברת, לא ללקוחה)
```

## התחברות צלם (Supabase Auth)

`/login` מציג טופס עם טאב "התחברות" ו"הרשמה" (`app/login/page.tsx`), מבוסס
`@supabase/ssr` כדי שה-session ישותף כעוגייה בין הדפדפן ל-middleware (בניגוד
לעוגיית ה-`httpOnly` של לקוחות הגלריה - שם זה מכוון, כאן זה הכרחי כדי
שה-middleware יוכל לקרוא את ה-session ולהגן על `/dashboard/*`).

בהרשמה, שם העסק נשמר ב-user metadata ומועבר ל-DB, שם טריגר
(`handle_new_photographer` ב-`supabase/schema.sql`) יוצר אוטומטית שורת
`photographers` מקושרת ל-`auth_user_id`. ה-RLS הקיים (`auth.uid() = auth_user_id`)
כבר תומך בזה בלי שינוי.

**חשוב להגדיר בפרויקט Supabase (Authentication → URL Configuration):**
- Site URL: `http://localhost:3000` (ובפרודקשן - הדומיין האמיתי)
- Redirect URLs: להוסיף `http://localhost:3000/auth/callback` (וגם את הדומיין בפרודקשן)

אם רוצים לדלג על אימות מייל בזמן פיתוח מקומי, אפשר לכבות "Confirm email" תחת
Authentication → Providers → Email — אז יש session מיד אחרי הרשמה, בלי הצורך
בקישור אימות.

**שחזור סיסמה**: קישור "שכחת סיסמה?" במסך ההתחברות מוביל ל-`/login/forgot-password`,
ששולח `resetPasswordForEmail` עם `redirectTo` שמצביע חזרה ל-`/auth/callback` הקיים
(עם `?next=/login/reset-password`) - אותו endpoint שכבר משמש לאימות הרשמה, רק עם
יעד סיום שונה. שם, `/login/reset-password` קובע סיסמה חדשה דרך `updateUser`, כי יש
כבר session מסוג recovery מהקוד שהוחלף. תמיד מוצגת הודעת הצלחה גנרית גם אם הכתובת
לא רשומה, כדי לא לחשוף אילו מיילים קיימים במערכת (user enumeration). **שימו לב**:
Supabase דוחה כתובות בדומיינים שמורים כמו `example.com` עם שגיאת `email_address_invalid`
(אין להם שרת מייל אמיתי) - זה תקין ולא קשור לקוד; עם דומיין רגיל (gmail.com וכו') זה עובד.

## יצירת גלריה חדשה

מ-`/dashboard/galleries` יש כפתור "+ גלריה חדשה" שמוביל ל-`/dashboard/galleries/new`
(`app/dashboard/galleries/new/page.tsx`). הטופס אוסף שם ואימייל של הלקוחה, מספר
תמונות כלול בחבילה, מחיר לתמונה נוספת, ותוקף (אופציונלי), ושולח ל-`app/api/galleries/route.ts`.

ה-API route רץ עם ה-session של הצלם המחובר (לא service key), כך שה-RLS הקיים
דואג מעצמו שאי אפשר ליצור רשומות תחת photographer_id של מישהו אחר. הוא:
1. שולף את שורת ה-`photographers` של המשתמש המחובר
2. יוצר `client` עם קוד גישה אקראי בן 8 תווים (ומנסה שוב אם יש התנגשות נדירה בקוד)
3. יוצר `gallery` (סטטוס `sent`) ו-`package` תחתיה
4. אם שלב כלשהו נכשל - מוחק את מה שכבר נוצר, כדי לא להשאיר רשומות יתומות

בסיום, אם `RESEND_API_KEY` מוגדר, נשלח ללקוחה מייל אוטומטי עם הקישור והקוד
(`sendGalleryInviteEmail` ב-`lib/email.ts`) - זו קריאת best-effort, כישלון שליחה
לא מבטל את יצירת הגלריה. המסך מציג באנר ירוק "נשלח אוטומטית" או באנר עם הוראה
לשליחה ידנית, לפי `emailSent` שחוזר מה-API. בכל מקרה גם מוצג קישור לגלריה
(`/gallery/{id}`) וקוד הגישה, עם כפתור העתקה וקישור ישיר להעלאת תמונות.

כל שורה ברשימת הגלריות (`/dashboard/galleries`) לחיצה עליה מובילה לדף ההעלאה של
אותה גלריה; קישור "✎ עריכה" נפרד (עם `stopPropagation` כדי לא להפעיל גם את
הניווט להעלאה) מוביל ל-`/dashboard/galleries/{id}/edit`, שם אפשר לערוך את פרטי
הלקוחה/החבילה/תוקף (`PATCH /api/galleries/{id}`) או למחוק את הגלריה כליל
(`DELETE /api/galleries/{id}` - מוחק גם את קבצי ה-Storage בפועל, לא רק את
השורות ב-DB, ומוחק גם את שורת ה-`client` הקשורה).

## איך הגישה של הלקוחה עובדת עכשיו (אחרי תיקון אבטחה)

בגרסה הראשונית דף הגלריה קרא/כתב ישירות ל-Supabase עם ה-anon key, אבל מדיניות
ה-RLS מאפשרת גישה רק לצלם מחובר (`auth.uid()`) - כך שבפועל הלקוחה לא הייתה
מצליחה לטעון תמונות או לשמור בחירה, וגם עוגיית ה-session (`httpOnly`) לא ניתנת
לקריאה מ-JS כמו שהקוד ניסה לעשות. התיקון:

1. `verify-access` מייצר session token **חתום** (HMAC-SHA256, ראו `lib/session.ts`) במקום base64 גולמי, ושומר אותו בעוגיית `httpOnly`.
2. כל פעולה של הלקוחה (טעינת גלריה, שינוי סטטוס, הערה) עוברת דרך `app/api/gallery/[id]/*` — API בצד שרת שמאמת את החתימה מול `SESSION_SECRET` ורק אז פונה ל-Supabase עם ה-`service_role` key.
3. ה-bucket `gallery-photos` פרטי (לא ציבורי). התמונות מוצגות דרך signed URL זמני (שעה) שנוצר בצד שרת, כך שאין URL קבוע שדולף/נשאר נגיש אחרי שהגלריה פגה.
4. השוואת קוד הגישה נעשית בזמן קבוע (`safeCompare` ב-`lib/session.ts`), כדי לא לחשוף מידע על הקוד הנכון דרך תזמון התשובה.

בגלל שינוי ה-bucket לפרטי, טבלת `photos` שומרת עכשיו **נתיב** בתוך ה-bucket (`file_path`/`thumbnail_path`) ולא URL ציבורי — אם הרצתם גרסה קודמת של הסכמה, יש הערת מיגרציה בתחתית `supabase/schema.sql`.

צריך להוסיף ל-`.env.local` גם `SESSION_SECRET` (ערך אקראי חזק, למשל `openssl rand -base64 32`) — בלעדיו אי אפשר ליצור/לאמת session.

## פיצ'רים נוספים שמומשו
- **הערות על תמונה**: אייקון ✎ מופיע רק על תמונות עם סטטוס (אולי/נבחר); שומר לשדה `note` בטבלת `selections`
- **מצב השוואה בין 2**: כפתור "השוואה בין 2 תמונות" עובר למצב שבו קליק על שתי תמונות פותח אותן זו לצד זו בגודל מלא
- **סטטוס "אולי" מול "נבחר"**: אייקון לב על כל תמונה מחזור בין שלושה מצבים בכל קליק — כלום ← אולי (ירוק) ← נבחר (זהב) ← כלום. רק סטטוס "נבחר" נספר מול מכסת החבילה; "אולי" הוא רשימת ביניים של הלקוחה שלא מחייבת תשלום
- **עיצוב כהה-זהב** בהשראת מוצרים כמו ONYX: רקע כהה, מסגרות זהב/ירוק לפי סטטוס, לג'נדה בכותרת, ומד התקדמות עגול
- **רשימת גלריות בדשבורד**: לכל גלריה - סטטוס (בבחירה/הושלם/ממתין לפתיחה/באיחור), אחוז ומספר תמונות שנבחרו מול החבילה, ו"פעילות אחרונה" מחושבת (עודכן לפני X / ללא פעילות / הושלם אתמול). מתעדכן אוטומטית ב-DB (trigger) בכל בחירה/ביטול בחירה של לקוחה

## הרצה ראשונה

### 1. הקמת Supabase
1. פותחים פרויקט חדש ב-[supabase.com](https://supabase.com) (יש טיר חינמי)
2. בלשונית **SQL Editor**, מדביקים ומריצים את כל התוכן של `supabase/schema.sql`
3. בלשונית **Project Settings → API**, מעתיקים את ה-URL וה-anon key

### 2. הגדרת סביבה מקומית
```bash
cp .env.local.example .env.local
# לערוך את .env.local ולהדביק את הפרטים מ-Supabase
npm install
```

### 3. הרצה
```bash
npm run dev
```
האתר יעלה על http://localhost:3000

## מה עדיין חסר (השלבים הבאים)
- חיוב בפועל על חריגה מהחבילה (אינטגרציית סליקה)

## תצוגה מקדימה עם סימן מים

בעת ההעלאה (`app/dashboard/upload/[galleryId]/page.tsx`), כל תמונה עוברת גם קריאה
ל-`POST /api/galleries/[id]/photos/[photoId]/process` - route בצד שרת שמוריד את
המקור מ-Storage, מקטין אותו ל-2000px בצלע הארוכה ומטביע עליו סימן מים חוזר
(שם העסק של הצלמת, ב-`lib/watermark.ts` עם Sharp) לפני שהוא נשמר כ-`thumbnail_path`
נפרד מה-`file_path` המקורי.

- `file_path` (המקור הנקי, בלי סימן מים) לא נחשף ללקוחה בשום מקום - לא בגריד
  ולא במצב השוואה מוגדל (`app/api/gallery/[id]/route.ts` מחזיר signed URL אחד,
  מ-`thumbnail_path`, גם ל-`thumbnailUrl` וגם ל-`fullUrl`)
- המקור הנקי משמש רק בצד שרת, למסירה הסופית אחרי בחירה
  (`app/api/galleries/[id]/selected-photos`)
- ההעלאה עצמה לא נחסמת אם עיבוד סימן המים נכשל בתמונה בודדת - `thumbnail_path`
  פשוט נשאר זהה ל-`file_path` (המצב שהיה קיים לפני הפיצ'ר), וההעלאה ממשיכה
  לשאר הקבצים

## בדיקות אוטומטיות

```bash
npm test
```

מריץ את חבילת ה-Vitest (`vitest.config.mts`). הבדיקות מתמקדות בלוגיקה הטהורה
והכי רגישה מבחינת אבטחה - לא בדקות end-to-end מול Supabase אמיתי (זה כבר נבדק
ידנית לאורך הפרויקט):

- `lib/session.test.ts` - חתימה/אימות של session tokens: round-trip תקין, דחיית
  טוקן שנבדק מול galleryId אחר, תפוגה, שיבוש חתימה/payload, וסוד שגוי
- `lib/galleryAccess.test.ts` - `checkGalleryWritable` עם מוק ל-Supabase: מותר/אסור
  לכתוב לפי סטטוס ותוקף, כולל מקרה הקצה של גלריה שגם הושלמה וגם פג תוקפה
- `lib/accessLockout.test.ts` - לוגיקת הנעילה של הגנת ה-brute-force על קוד הגישה:
  מתי נחשב נעול, ספירת ניסיונות עד `MAX_ATTEMPTS`, ואיפוס אחרי הצלחה
- `lib/email.test.ts` - `lib/email.ts` עם `fetch` מדומה: דילוג שקט כשאין
  `RESEND_API_KEY`, שליחה מוצלחת, טיפול בתשובת שגיאה מ-Resend, והתראת "סיימה
  לבחור" לצלמת

## כפתור הקסם - תוקן מיקום + נוסף ZIP fallback

`components/MagicButton.tsx` היה קיים מההתחלה אבל **לא היה מחובר לשום דף** - בדף
הלקוחה (`app/gallery/[id]/page.tsx`) היה כפתור מקושט זהה חזותית שלא עשה כלום.
זו הייתה גם טעות מיקום: הפיצ'ר דורש מהמשתמש לבחור תיקיית מקור *במחשב שלו* עם
כל התמונות המקוריות - רלוונטי לצלמת (יש לה את הקבצים המקוריים), לא ללקוחה.

- הכפתור המקושט הוסר מדף הלקוחה
- `MagicButton` האמיתי חובר לדף העריכה של הצלמת (`app/dashboard/galleries/[id]/edit/page.tsx`)
- נוסף **ZIP fallback** לדפדפנים בלי File System Access API (Safari/Firefox): כפתור
  שמוריד את כל התמונות שסומנו "נבחר" כקובץ ZIP אחד, דרך `app/api/galleries/[id]/selected-photos/route.ts`
  (מחזיר signed URLs זמניים - הצלמת לא הייתה יכולה בעבר לגשת בכלל לתמונות שלה
  מחוץ לזמן ההעלאה, כי ה-bucket פרטי ואין policy שמאפשרת לה קריאה ישירה)
- שני המסלולים (File System Access + ZIP) עכשיו מסננים רק תמונות בסטטוס `selected`
  (לא `maybe`) - זו הייתה גם באג קטן בגרסה הקודמת

## מה תוקן (אבטחה)
- session token חתום (HMAC) במקום base64 גולמי - ראו "איך הגישה של הלקוחה עובדת עכשיו" למעלה
- bucket פרטי + signed URLs זמניים במקום URL ציבורי קבוע
- השוואת קוד גישה בזמן קבוע (מונע timing attack)
- policies חסרות ל-`packages` ו-`sync_jobs` (בלעדיהן אף אחד לא היה יכול לגשת לטבלאות האלה, גם לא הצלם המחובר)
- התחברות/הרשמה אמיתית לצלם (Supabase Auth + middleware שמגן על `/dashboard/*`) - עד עכשיו דפי הצלם היו נראים תקינים אבל לא מחזירים נתונים בפועל, כי היה חסר login שדרכו `auth.uid()` מקבל ערך

## תזכורות וסטטוס אוטומטי

הגלריה עוברת בין הסטטוסים בשלוש דרכים שונות, כל אחת מהסיבה שמתאימה לה:

1. **`sent`/`draft` → `in_progress`**: אוטומטי, מיידי, ב-DB - טריגר על טבלת `selections`
   (`update_gallery_last_activity` ב-`supabase/schema.sql`) מזהה בחירה ראשונה של הלקוחה
   ומעדכן את הסטטוס באותה טרנזקציה. אין תלות ב-cron בשביל זה.
2. **→ `completed`**: פעולה מפורשת של הלקוחה - כפתור "סיימתי לבחור ✓" בתחתית הגלריה
   (`app/gallery/[id]/page.tsx`, קורא ל-`app/api/gallery/[id]/finish/route.ts`). זה
   **לא** מחושב אוטומטית ממספר התמונות שנבחרו, כי הגעה למכסת החבילה לא אומרת שהלקוחה
   סיימה - היא עשויה לרצות לבחור פחות, או יותר (ולשלם על החריגה). אחרי שהיא לוחצת,
   הגלריה ננעלת: `app/api/gallery/[id]/selection/route.ts` ו-`note/route.ts` דוחים
   שינויים נוספים דרך `lib/galleryAccess.ts`. באותה קריאה גם נשלח מייל לצלמת
   (`sendSelectionCompleteEmail` ב-`lib/email.ts`) עם מספר התמונות שנבחרו וקישור
   ישיר לדף העריכה של הגלריה - עד עכשיו לא הייתה שום דרך לדעת שהלקוחה סיימה חוץ
   מלהיכנס ולבדוק ידנית. best-effort כמו שאר המיילים - כשל בשליחה לא מפיל את הבקשה.
3. **→ `expired`**: תלוי בזמן, לא באירוע - חייב job שרץ מדי פעם. `app/api/cron/tick/route.ts`
   מסמן `expired` לכל גלריה שעבר `expires_at` שלה (ולא כבר `completed`), ובאותה ריצה גם
   שולח תזכורת מייל חד-פעמית ללקוחות שהגלריה שלהם מתקרבת לתוקף (`reminder_days` על
   הגלריה, או `reminder_days_default` של הצלם אם לא הוגדר במפורש) ועוד לא קיבלו תזכורת
   (`last_reminder_sent_at is null`). המייל נשלח דרך Resend (`lib/email.ts`) - בלי
   `RESEND_API_KEY` הפונקציה מדלגת על השליחה בלבד (מדפיסה אזהרה), כך שסימון התפוגה
   עדיין עובד גם בלי שירות מייל מחובר.

   בדשבורד (`app/dashboard/galleries/page.tsx`) יש גם חישוב `expired` "וירטואלי" לפי
   `expires_at` בצד לקוח, כדי שהתצוגה תהיה נכונה מיד גם בין ריצת cron אחת לשנייה -
   אבל זה קוסמטי בלבד; הבדיקה שבאמת חוסמת כניסה ללקוחה (`app/api/gallery/[id]/route.ts`)
   בודקת `expires_at` בזמן אמת בכל בקשה, בלי תלות בעמודת `status` בכלל.

**הפעלת ה-cron בפועל** - `app/api/cron/tick` מוגן ב-`CRON_SECRET`, ומצפה לו כ-
`Authorization: Bearer <secret>` או כ-`?secret=<secret>` ב-query. יש כמה אופציות:
- **Vercel Cron** (אם מפרסמים ב-Vercel): הוגדר כבר ב-`vercel.json` (פעם ביום, 08:00 UTC).
  צריך רק להגדיר `CRON_SECRET` במשתני הסביבה של הפרויקט ב-Vercel - Vercel שולח אותו
  אוטומטית כ-Authorization header.
- **שירות cron חיצוני** (cron-job.org וכו') או **Supabase pg_cron + pg_net**: קוראים
  ל-`GET https://<domain>/api/cron/tick?secret=<CRON_SECRET>` בתדירות הרצויה.
- **בדיקה מקומית**: `curl "http://localhost:3000/api/cron/tick?secret=$CRON_SECRET"`

## עיצוב אחיד (כהה-זהב) בכל המסכים

בגרסה הראשונית רק דף הגלריה של הלקוחה (`app/gallery/[id]/page.tsx`) קיבל עיצוב -
כל דפי הצלם (התחברות, רשימת גלריות, יצירת גלריה, העלאה) היו CSS ברירת מחדל של
הדפדפן, בלי שום עיצוב. `lib/theme.ts` מרכז את הפלטה (`theme.bg`, `theme.gold` וכו')
ואת סגנונות ה-input/button החוזרים, כדי שכל המסכים ישתמשו באותה שפה עיצובית:

- `app/login/page.tsx` - התחברות/הרשמה
- `app/dashboard/layout.tsx` - הכותרת העליונה (כפתור התנתקות) שעוטפת את כל דפי הצלם
- `app/dashboard/galleries/page.tsx` - תגי סטטוס צבעוניים (זהב=בבחירה, ירוק=הושלם, אדום=באיחור)
- `app/dashboard/galleries/new/page.tsx` - טופס יצירת גלריה ומסך ההצלחה
- `app/dashboard/upload/[galleryId]/page.tsx` - וגם **תצוגה מקדימה אמיתית של התמונות** בגריד
  (thumbnails מקומיים דרך `URL.createObjectURL`, עם ✓/✕ לכל תמונה) - קודם היה רק טקסט
  "N קבצים נבחרו" בלי שום משוב חזותי
- `app/gallery/[id]/page.tsx` - גם מסך הזנת קוד הגישה ומסך הטעינה (לא רק תצוגת הגלריה עצמה,
  שכבר הייתה מעוצבת) עברו לאותה פלטה, כולל באנר השגיאה על קוד שגוי

דף הגלריה של הלקוחה (החלק שכבר היה מעוצב) ממשיך להשתמש בערכי hex מוטבעים במקום
ב-`lib/theme.ts` - הם זהים בערכם, פשוט לא הועברו לקובץ המשותף כדי לא לגעת בקוד
שכבר עבד ונבדק.

## הערה על אבטחה
חסימת קליק ימני וגרירה בקוד (`onContextMenu`, `draggable={false}`) היא **הרתעה בלבד**,
לא הגנה טכנית אמיתית — כפי שציינו באפיון. משתמש טכני יכול לעקוף את זה בקלות
(DevTools, screenshot וכו'). זה בסדר גמור לשלב הזה, רק חשוב לא להבטיח ללקוחות
הגנה שלא קיימת בפועל.
