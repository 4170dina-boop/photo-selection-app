// עברית: סינונים, הודעה קופצת "בוחרים ביחד" וכרטיסי התמונות בגריד.
import type { Message } from '../types';

export const grid = {
  'f.all': 'הכל ({n})',
  'f.selected': 'נבחרו ({n})',
  'f.maybe': 'אולי ({n})',
  'f.picks': '⭐ המלצות הצלמת ({n})',
  'card.pickBadge': '⭐ המלצת הצלמת',
  'card.pickTitle': 'תמונה שהצלמת ממליצה עליה במיוחד',
  'f.together': '💞 כולם בחרו ({n})',
  'f.only': 'רק {name} ({n})',
  'f.onlyMe': 'רק אני ({n})',
  'grid.empty': 'אין תמונות להצגה בסינון הזה.',
  'grid.colsAria': 'מספר עמודות בגריד: {n} (לחיצה מחליפה)',

  // "סימן/ה" - השם יכול להיות של גבר או של אישה
  'toast.othersItem': {
    one: '{name} סימן/ה תמונה חדשה',
    other: '{name} סימן/ה {count} תמונות חדשות',
  },

  'card.compareOn': 'נבחרה להשוואה',
  'card.compareOff': 'לא נבחרה להשוואה',
  'card.open': 'פתיחת {label}',
  'card.hasNote': ', יש הערה',
  'card.badgeMaybe': '🤔 אולי',
  'card.blurAria': 'ייתכן שהתמונה לא חדה (הערכה אוטומטית)',
  'card.blurTitle': 'הערכה אוטומטית לפי חדות - לא תמיד מדויקת',
  'card.blurLabel': '💡 ייתכן שלא חדה',
  'card.markSelected': 'נבחר',
  'card.markMaybe': 'אולי',
  'card.giftTitle': 'תמונת מתנה - כלולה אצלך אוטומטית, לא נספרת בחבילה ובלי תוספת תשלום',
  'card.giftFooter': 'כלולה אוטומטית · לא נספרת בחבילה',
  'card.heartAria': 'בחירת {label}',
  'card.heartOn': 'ביטול בחירה',
  'card.heartOff': 'בחירת התמונה',
  'card.noteTitle': 'יש הערה לתמונה הזו',
} satisfies Record<string, Message>;
