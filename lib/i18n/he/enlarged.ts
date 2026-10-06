// עברית: התצוגה המוגדלת (כולל פס הבחירה), הסקירה ברצף וחלון ההערה.
import type { Message } from '../types';

export const enlarged = {
  'en.aria': 'תצוגה מוגדלת: תמונה {n}',
  'en.kbd': 'חצים לדפדוף בין התמונות, Escape לסגירה',
  'en.kbdMark': '. מקש S - אני רוצה את זו, מקש M - אולי',
  'en.zoomTitle': 'קליק או גלגלת עכבר להגדלה/הקטנה',
  'en.counter': 'תמונה {current} / {total}',
  'en.selected': 'נבחרו',
  'en.extra': '+{n} נוספות',
  'en.extraCost': ' (תוספת {cost})',
  'en.guestMine': 'הבחירות שלך (קלט בלבד): {n}',
  'en.othersPicked': {
    one: '💞 גם {names} בחר/ה בתמונה הזו',
    other: '💞 גם {names} בחרו בתמונה הזו',
  },
  'en.noteEditAria': 'עריכת ההערה לצלמת על התמונה',
  'en.noteAddAria': 'הוספת הערה לצלמת על התמונה',
  'en.noteEdit': '✎ עריכת ההערה לצלמת',
  'en.noteAdd': '✎ הערה לצלמת',
  'en.wantTitle': 'אני רוצה את זו (מקש S)',
  'en.want': '✓ אני רוצה את זו',
  'en.wantOn': 'נבחרה · לחיצה נוספת מבטלת',
  'en.maybeTitle': 'אולי (מקש M)',
  'en.maybe': '🤔 אולי',
  'en.maybeOn': 'מסומנת',
  'en.giftFromMe': '🎁 מתנה ממני',
  'en.giftIncluded': ' - כלולה אצלך אוטומטית, אין צורך לבחור אותה',

  'ss.aria': 'סקירה ברצף: תמונה {i} מתוך {total}',
  'ss.exitTitle': 'יציאה ממצב סקירה',
  'ss.exit': '✕ יציאה',
  'ss.maybeOn': '✓ אולי',
  'ss.maybeOff': '? אולי',
  'ss.selectedOn': '✓ נבחרה',
  'ss.select': '✓ בחירה',
  'ss.giftIncluded': '🎁 מתנה ממני - כלולה אוטומטית',

  'note.title': 'הערה לתמונה',
  'note.reply': 'תגובת {name}:',
  'note.placeholder': 'למשל: את זו רוצה בשחור-לבן',
} satisfies Record<string, Message>;
