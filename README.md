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
app/dashboard/galleries/[id]/edit/page.tsx   → עריכת פרטי לקוחה/חבילה/תוקף, מחיקת גלריה, ושליחת הזמנה מחדש
app/api/galleries/route.ts                   → יצירת client+gallery+package בשרת, עם session הצלם (לא service key)
app/api/galleries/[id]/route.ts              → GET/PATCH/DELETE לגלריה קיימת, עם session הצלם (לא service key)
app/api/galleries/[id]/resend-invite/route.ts → שולחת שוב את מייל ההזמנה (קישור + קוד גישה) ללקוחה קיימת
app/api/gallery/[id]/finish/route.ts         → "סיימתי לבחור" - נועל את הגלריה (status=completed)
app/api/cron/tick/route.ts                   → מסמן גלריות שפג תוקפן + שולח תזכורות מייל (מופעל ע"י scheduler חיצוני)
lib/email.ts                                 → שליחת מייל (הזמנה לגלריה + תזכורת תפוגה) דרך Resend (no-op אם אין RESEND_API_KEY)
lib/sharpness.ts                             → ציון חדות היוריסטי (Laplacian variance) - לתג "ייתכן שמטושטשת" בגלריית הלקוחה
lib/galleryAccess.ts                         → בדיקה משותפת: אסור לערוך גלריה שהושלמה/פג תוקפה
lib/theme.ts                                 → פלטת הצבעים המשותפת (טוקנים + סגנונות input/button) - כל הדפים משתמשים בה
vercel.json                                  → תזמון Vercel Cron ל-/api/cron/tick (פעם ביום)
components/MagicButton.tsx                   → כפתור הקסם (File System Access API) + ZIP fallback, בדף העריכה של הצלמת
app/api/galleries/[id]/selected-photos/route.ts → signed URLs לתמונות שסומנו "נבחר" (לצלמת המחוברת, לא ללקוחה)
app/api/galleries/[id]/selections-export/route.ts → הורדת CSV (שם קובץ + הערה) של התמונות שנבחרו - למסירה למעבדת הדפסה
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

## מגבלות חשבון חינמי

עד שיש חיוב/מנוי אמיתי לצלמות, חשבון חינמי מוגבל לגלריה פעילה אחת בכל רגע נתון
ו-25 תמונות בגלריה - נאכף ב-DB (`enforce_active_gallery_limit`,
`enforce_photo_limit` ב-`supabase/schema.sql`), לא רק בקוד ה-API, כדי שאי אפשר
יהיה לעקוף את זה עם קריאה ישירה ל-Supabase. שני המספרים מוצגים גם בצד לקוח
לפני שמגיעים לחסימה בפועל:
- **`app/dashboard/galleries/page.tsx`**: "X/1 גלריות פעילות" מעל רשימת הגלריות
- **`app/dashboard/upload/[galleryId]/page.tsx`**: "X/25 תמונות בגלריה" מעל כפתור ההעלאה

שני המספרים (1, 25) מוגדרים בנפרד בכל צד - אין מקור אמת משותף אחד, אז שינוי
המגבלה בפועל דורש עדכון גם ב-trigger וגם בתצוגה.

## שיתוף גלריה משפחתי

כמה בני משפחה יכולים להיכנס לאותה גלריה עם אותו קוד גישה, כל אחד מזוהה בשם
משלו ובוחר בנפרד - בלי לתת לאף אחד מהם הרשאת עריכה מלאה על הבחירה הרשמית.

- **`gallery_participants`** (טבלה חדשה) - שורה לכל אדם שנכנס לגלריה.
  `is_owner=true` היא הלקוחה הרשומה עצמה (`galleries.client_id`) - נוצרת
  אוטומטית עם הגלריה (`app/api/galleries/route.ts`), לא כשמישהו נכנס בפועל.
  שאר השורות הן אורחים (בני משפחה) שמצטרפים מאוחר יותר.
- **`selections.participant_id`** - כל בחירה שייכת למשתתף ספציפי (unique על
  `gallery_id, photo_id, participant_id` במקום `gallery_id, photo_id` כמו
  קודם), כדי שאפשר יהיה להראות מי בחר מה בלי לערבב בין אנשים.
- **זרימת הזיהוי**: `POST /api/verify-access` (כמו קודם) רק מאמת את קוד
  הגישה ופותח session בלי `participantId` עדיין. `GET /api/gallery/[id]`
  מזהה session כזה ומחזיר `needsIdentity: true` עם השם הרשום - המסך מציג
  "היי, [שם]! זאת את?" עם אפשרות לאשר או להקליד שם אחר. האישור/ההצטרפות
  עוברים דרך `POST /api/gallery/[id]/identify`, שחותם מחדש את ה-session עם
  `participantId` קבוע. session ישן (מלפני הפיצ'ר) פשוט מזוהה כ"עוד לא זוהה"
  ומקבל את אותו מסך - לא נשבר.
- **מה נספר רשמית**: רק בחירות ה-owner נספרות לפס ההתקדמות, לחריגה מהחבילה,
  לייצוא ה-CSV (`selections-export`) ולרשימת ההורדה של כפתור הקסם
  (`selected-photos`). בחירות של אורחים הן קלט לדיון בלבד - מוצגות כתגי
  ראשי-תיבות קטנים על כל תמונה, אבל לא משפיעות על שום חישוב.
- רק ה-owner רואה/יכולה ללחוץ "סיימתי לבחור" - אורחים רואים הודעה שמסבירה
  שרק הלקוחה הראשית יכולה לסיים.
- ברגע ש-owner מגיעה בדיוק למכסת החבילה, נשלחת התראה לצלמת
  (`sendQuotaReachedEmail`) - חד-פעמית, לא בכל בחירה נוספת אחרי זה.
  וברגע שהיא לוחצת "סיימתי לבחור", נשלח גם מייל אישור ללקוחה עצמה עם רשימת
  התמונות שבחרה (`sendClientSelectionSummaryEmail`), לצד המייל לצלמת שכבר
  היה קיים.

## מה עדיין חסר (השלבים הבאים)
- חיוב בפועל על חריגה מהחבילה (אינטגרציית סליקה) - `app/dashboard/galleries/page.tsx`
  כבר מציג לצלמת כמה חריגה יש וכמה זה שווה, גם לכל גלריה בנפרד וגם סה"כ מכל
  הגלריות יחד (`included_photos`/`extra_photo_price` שכבר קיימים ב-`packages`),
  רק שאין עדיין דרך לגבות את זה בפועל

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

## תג "ייתכן שמטושטשת"

**דורש הרצת מיגרציה ידנית ב-Supabase SQL Editor לפני שזה עובד בפועל** (ראו
למטה) - בלי זה הפיצ'ר פשוט לא מציג תגים, לא שובר כלום.

באותה קריאת עיבוד שכבר מקטינה ומטביעה סימן מים
(`app/api/galleries/[id]/photos/[photoId]/process/route.ts`), נחשב גם ציון
חדות (`lib/sharpness.ts`) - variance של Laplacian kernel על התמונה באפור,
היוריסטיקה קלאסית לזיהוי טשטוש (לא ML). ציון נמוך מ-`BLUR_THRESHOLD` (100,
לא מכויל על תמונות אמיתיות של המוצר - עשוי לדרוש כיוונון) מציג תג עדין
"ייתכן שמטושטשת" בגלריית הלקוחה (`app/gallery/[id]/page.tsx`). זו היוריסטיקה
תלוית-תוכן, לא שיפוט - תמונת שמיים נקיים תקבל ציון נמוך גם אם היא חדה
לגמרי, אז זה מוצג כרמז עדין שאפשר להתעלם ממנו, לא כפסק דין. הבחירה עצמה
אף פעם לא נחסמת בגלל זה.

**כדי שהתג יעבוד בפועל**, מריצים ב-Supabase SQL Editor:
```sql
alter table photos add column if not exists sharpness_score numeric;
```
עד אז, שני המקומות שקוראים את העמודה (`process/route.ts` בזמן עיבוד,
ו-`app/api/gallery/[id]/route.ts` בזמן טעינת הגלריה של הלקוחה) נכשלים
בשקט ופשוט לא מציגים תג - נבדק ומאומת שזה לא שובר את טעינת הגלריה.

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
- `lib/sharpness.test.ts` - `computeSharpnessScore` על תמונות אמיתיות (לא מוקים):
  תמונת בדיקה עם מרקם מקבלת ציון גבוה יותר מגרסה מטושטשת שלה, ותמונה שטוחה
  לגמרי מקבלת ציון קרוב לאפס
- `lib/watermark.test.ts` - `createWatermarkedPreview` על תמונות אמיתיות: מקטינה
  לגודל המרבי תוך שמירה על יחס הצלעות, לא מגדילה תמונה שכבר קטנה ממנו, באמת
  משנה את הפיקסלים (לא no-op), ולא נופלת על טקסט עם תווי XML מיוחדים

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

## תיקוני נייד

- **`app/layout.tsx`**: נוסף `viewport` מפורש עם `initialScale: 1`. Next.js מזריק ברירת
  מחדל (`width=device-width`) גם בלעדיו, אבל בלי `initial-scale=1` יש דפדפנים ניידים
  שמתחילים מזוזמים - קריטי במיוחד כי דף הגלריה של הלקוחה (`app/gallery/[id]/page.tsx`)
  הוא mobile-first ברובו (קוד גישה, בחירת תמונות)
- **`lib/theme.ts`**: `inputStyle.fontSize` עלה מ-14 ל-16px - מתחת ל-16px, iOS Safari
  מזום אוטומטית פנימה בפוקוס על שדה טקסט, מה שממש מפריע בהזנת קוד גישה או הערה
  מהנייד. משפיע על כל שדה שמשתמש ב-`inputStyle` (7 קבצים, כולל טופסי הצלם וגם
  מסך הגלריה של הלקוחה)

## הערה על אבטחה
חסימת קליק ימני וגרירה בקוד (`onContextMenu`, `draggable={false}`) היא **הרתעה בלבד**,
לא הגנה טכנית אמיתית — כפי שציינו באפיון. משתמש טכני יכול לעקוף את זה בקלות
(DevTools, screenshot וכו'). זה בסדר גמור לשלב הזה, רק חשוב לא להבטיח ללקוחות
הגנה שלא קיימת בפועל.
