// עברית: שער הפתיחה, הכותרת העליונה (מונים), באנר אופליין ותיבת פרטי החבילה.
import type { Message } from '../types';

export const welcome = {
  'welcome.title': { f: 'ברוכה הבאה{nameSuffix}!', m: 'ברוך הבא{nameSuffix}!' },
  'welcome.ready': 'הגלריה מוכנה לבחירה',
  'welcome.package': ' - יש לך {n} תמונות במסגרת החבילה',
  'welcome.until': ', עד {date}',
  'welcome.end': '.',
  'welcome.gifts': {
    one: '🎁 מחכה לך בגלריה גם תמונת מתנה ממני - בלי לגרוע מהחבילה',
    other: '🎁 מחכה לך בגלריה גם {count} תמונות מתנה ממני - בלי לגרוע מהחבילה',
  },
  'welcome.start': { f: 'בואי נתחיל ✨', m: 'בוא נתחיל ✨', n: 'בוא/י נתחיל ✨' },

  'hdr.connectedAs': { f: 'מחוברת בתור {name}', m: 'מחובר בתור {name}' },
  'hdr.family': ' (משפחה)',
  'hdr.compare': '⇄ השוואה',
  'hdr.exitCompare': { f: '✕ צאי ממצב השוואה', m: '✕ צא ממצב השוואה', n: '✕ צא/י ממצב השוואה' },
  'hdr.swipe': '⚡ בחירה מהירה',
  'hdr.exitSwipe': { f: '✕ צאי מבחירה מהירה', m: '✕ צא מבחירה מהירה', n: '✕ צא/י מבחירה מהירה' },
  'hdr.more': '⋯ עוד',
  'hdr.moreAria': 'פעולות נוספות',
  'hdr.selectedInPackage': 'נבחרו במסגרת החבילה',
  'hdr.viewed': 'עברת על {seen} מתוך {total} תמונות',
  'hdr.viewedAria': 'תמונות שעברת עליהן',

  'off.noInternet': '📴 אין חיבור לאינטרנט - ',
  'off.pending': {
    one: 'שינוי אחד ממתין ויישלח אוטומטית כשהחיבור יחזור.',
    other: '{count} שינויים ממתינים ויישלחו אוטומטית כשהחיבור יחזור.',
  },
  'off.keepGoing': 'אפשר להמשיך לדפדף ולבחור - הבחירות יישלחו כשהחיבור יחזור.',

  'info.packageIncludes': 'החבילה כוללת {n} תמונות',
  'info.remaining': ' · נשארו לך עוד {n} במסגרת החבילה',
  'info.extraPrice': '✨ כל תמונה נוספת: {price}',
  'info.estimate': 'סה״כ משוער לחבילה: {total}',
  'info.estimateBreakdown': ' ({base} חבילה + {extra} תוספת)',
  'info.agreedTotal': 'סה״כ לתשלום: {total}',
  'info.until': 'ניתן לבחור עד {date}',
} satisfies Record<string, Message>;
