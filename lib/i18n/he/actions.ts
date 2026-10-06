// עברית: כפתורי הפעולה מתחת לבאנרים, חלון ההשוואה ו"בחירה מהירה".
import type { Message } from '../types';

export const actions = {
  'act.exitCompare': { f: 'צאי ממצב השוואה', m: 'צא ממצב השוואה', n: 'צא/י ממצב השוואה' },
  'act.compareMany': '⇄ השוואה בין כמה תמונות',
  'act.compareHint': {
    f: 'בחרי עד {max} תמונות להשוואה ({count}/{max})',
    m: 'בחר עד {max} תמונות להשוואה ({count}/{max})',
  },
  'act.compareNow': 'השוואה כעת ({count})',
  'act.slideshow': '▶ סקירה ברצף',
  'act.clearing': { f: 'מבטלת...', m: 'מבטל...' },
  'act.clearAll': '🗑 ביטול כל הבחירה שלי',
  'act.clearConfirm': 'לבטל את כל הבחירות שלך בגלריה הזו? אי אפשר לשחזר את זה.',
  'act.aiTitle': "Claude מנתחת עד 60 תמונות ומסמנת 'אולי' על הטובות ביותר - נקודת פתיחה, לא בחירה סופית",
  'act.aiRunning': 'מנתחת תמונות...',
  'act.aiHelp': { f: '🪄 עזרי לי לבחור', m: '🪄 עזור לי לבחור', n: '🪄 עזור/י לי לבחור' },
  'act.aiPicked': 'סימנתי {picked} תמונות כ"אולי" מתוך {analyzed} שנותחו - עדיין אפשר לשנות הכל',
  'act.aiNone': 'לא מצאתי תמונות מובהקות לסמן - ייתכן שכבר סימנת את כולן',
  // מגדר הבעלים
  'act.onlyOwnerFinal': {
    f: 'רק {owner} יכולה לסיים את הבחירה הסופית - הבחירות שלך כאן הן קלט לדיון.',
    m: 'רק {owner} יכול לסיים את הבחירה הסופית - הבחירות שלך כאן הן קלט לדיון.',
  },

  'cmp.aria': 'השוואת תמונות',
  'cmp.exit': 'יציאה ממצב השוואה',
  'cmp.pick': { f: 'בחרי את זו ✓', m: 'בחר את זו ✓' },

  'sw.summaryAria': 'סיכום בחירה מהירה',
  'sw.doneSecond': 'סיימת גם את הסבב השני!',
  'sw.doneAll': 'עברת על כל התמונות!',
  'sw.maybePrompt': 'סימנת {n} תמונות כ"אולי" - רוצה לעבור עליהן שוב ולהחליט סופית?',
  'sw.secondPass': 'כן, סבב שני על "אולי" ({n})',
  'sw.noThanks': 'לא תודה, סיימתי',
  'sw.aria': 'בחירה מהירה: תמונה {i} מתוך {total}',
  'sw.labelSecond': 'סבב שני · "אולי" · ',
  'sw.label': 'בחירה מהירה · ',
  'sw.closeAria': 'סגירת בחירה מהירה',
  'sw.skipAria': 'דילוג - בלי לשנות את הסימון',
  'sw.skip': 'דילוג',
  'sw.maybeAria': { f: 'סמני כאולי', m: 'סמן כאולי' },
  'sw.maybe': 'אולי',
  'sw.pickAria': { f: 'בחרי תמונה זו', m: 'בחר תמונה זו' },
  'sw.picked': 'בחרתי',

  'status.selected': '✓ נבחרה',
  'status.maybeMarked': '🤔 מסומנת כאולי',
  'status.unmarked': 'לא מסומנת',
  'status.selectedPlain': 'נבחרה',
  'status.maybePlain': 'מסומנת כאולי',
  'status.giftPlain': 'תמונת מתנה - כלולה אוטומטית',
} satisfies Record<string, Message>;
