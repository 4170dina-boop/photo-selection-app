// Service worker למצב אופליין בגלריית הלקוחה: ממטמן תמונות (URLs חתומים של
// Cloudflare R2, וגם הפורמט הישן של Supabase Storage) אחרי שנטענו בהצלחה פעם
// אחת, כדי שדפדוף בתמונות שכבר נצפו ימשיך לעבוד גם באינטרנט חלש/מנותק באירוע.
// לא נוגע בבקשות API/HTML, וגם לא ב-fetch() של הורדות (ZIP/הורדה בודדת) -
// רק בבקשות שהיעד שלהן הוא תמונה (<img>), כדי לא להגיש נתונים מיושנים.

const IMAGE_CACHE = 'gallery-images-v2';
const MAX_CACHE_ENTRIES = 300;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith('gallery-images-') && n !== IMAGE_CACHE).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

function isR2Url(url) {
  return url.hostname === 'r2.cloudflarestorage.com' || url.hostname.endsWith('.r2.cloudflarestorage.com');
}

function hasAmzSignature(url) {
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === 'x-amz-signature') return true;
  }
  return false;
}

function isGalleryImageUrl(url) {
  if (url.pathname.includes('/storage/v1/object/sign/')) return true; // Supabase Storage (ישן)
  if (isR2Url(url)) return true;
  // נקודת קצה S3-compatible אחרת (R2_ENDPOINT_OVERRIDE, path-style) - URL חתום מזוהה לפי החתימה
  return hasAmzSignature(url);
}

// מפתח המטמון בלי פרמטרי החתימה: החתימה (X-Amz-*, או token ב-Supabase)
// משתנה בכל טעינה (תוקף שעה), אבל אותה תמונה נשארת באותו נתיב - כך שהמטמון
// ממשיך לשמש גם אחרי חידוש החתימה.
function cacheKeyFor(url) {
  if (url.pathname.includes('/storage/v1/object/sign/')) return url.origin + url.pathname;
  const kept = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase().startsWith('x-amz-')) continue;
    kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return url.origin + url.pathname + (query ? `?${query}` : '');
}

// מגביל את גודל המטמון - cache.keys() מחזיר לפי סדר ההכנסה, אז הראשונים הם הישנים.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

async function handleImageRequest(request, url) {
  const cacheKey = cacheKeyFor(url);
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // בקשת CORS (ה-bucket מוגדר עם CORS ל-GET, ראו README) כדי שנוכל לראות
  // את הסטטוס בפועל ולשמור רק תשובות תקינות - תשובה opaque יכולה להיות גם
  // 403 של חתימה שפגה, ושמירה שלה הייתה "שוברת" את התמונה עד שתפונה מהמטמון.
  let response;
  try {
    response = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
  } catch {
    // CORS לא מוגדר / רשת - נופלים לבקשה המקורית, בלי לשמור (אין לנו דרך לדעת אם היא תקינה)
    return fetch(request);
  }

  if (response.ok) {
    await cache.put(cacheKey, response.clone());
    trimCache(cache, MAX_CACHE_ENTRIES).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.destination !== 'image') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (!isGalleryImageUrl(url)) return;

  event.respondWith(handleImageRequest(request, url));
});

// חשיפה לבדיקות (lib/swCache.test.ts טוען את הקובץ ב-vm) - לא בשימוש בדפדפן.
self.__galleryImageCache = { isGalleryImageUrl, cacheKeyFor, trimCache, MAX_CACHE_ENTRIES };
