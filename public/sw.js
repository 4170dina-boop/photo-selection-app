// Service worker למצב אופליין בגלריית הלקוחה: ממטמן תמונות מ-Supabase Storage
// אחרי שנטענו בהצלחה פעם אחת, כדי שדפדוף בתמונות שכבר נצפו ימשיך לעבוד גם
// באינטרנט חלש/מנותק באירוע. לא נוגע בבקשות API/HTML - רק בתמונות, כדי לא
// להגיש נתונים מיושנים (בחירות, אימות) מהמטמון.

const IMAGE_CACHE = 'gallery-images-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function isGalleryImageRequest(url) {
  return url.pathname.includes('/storage/v1/object/sign/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (!isGalleryImageRequest(url)) return;

  // מפתח המטמון בלי ה-query: הטוקן החתום משתנה כל session (תוקף שעה), אבל
  // הנתיב של אותה תמונה קבוע - כך שהמטמון ממשיך לשמש גם אחרי חידוש הטוקן.
  const cacheKey = url.origin + url.pathname;

  event.respondWith(
    caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // תגובות מבקשות <img> הן לרוב 'opaque' (cross-origin, ok===false תמיד) -
        // עדיין שוות מטמון, כי הן בכל זאת ניתנות להצגה בתגית img.
        if (response.ok || response.type === 'opaque') {
          cache.put(cacheKey, response.clone());
        }
        return response;
      } catch (err) {
        throw err;
      }
    })
  );
});
