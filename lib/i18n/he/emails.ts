// עברית: מיילים ללקוח/ה (lib/email.ts) וההודעה המוכנה להעתקה
// (lib/clientInviteMessage.ts). מותר <b> בתבניות המייל; ערכים דינמיים
// מנוטרלים (escapeHtml) אצל הקורא לפני ההכנסה. מיילים לצלמת נשארים בעברית
// ולא עוברים דרך כאן.
import type { Message } from '../types';

export const emails = {
  'mail.brand': 'אזור צלמים',
  'mail.footer': 'נשלח דרך אזור צלמים ✨',
  'mail.codeLabel': 'קוד גישה',
  'mail.codeHint': 'לחיצה ארוכה על הקוד להעתקה',
  'mail.enterCta': 'כניסה לגלריה',
  'mail.hi': 'היי {name},',

  'mail.invite.subject': 'הגלריה שלך אצל {business} מוכנה!',
  'mail.invite.ready': 'הגלריה שלך אצל <b>{business}</b> מוכנה לבחירת תמונות! ✨',
  'mail.invite.howto': 'אפשר לסמן "אולי"/"נבחר" על כל תמונה, ולהוסיף הערות. בסיום, ללחוץ "סיימתי לבחור" כדי לשלוח את הבחירה.',

  'mail.reminder.subject': 'תזכורת: הגלריה שלך אצל {business} עומדת לפוג',
  'mail.reminder.expires': 'הגלריה שלך אצל <b>{business}</b> עומדת לפוג בתאריך <b>{date}</b>.',
  'mail.reminder.nudge': 'אם עוד לא סיימת לבחור תמונות, זה הזמן 💛',

  'mail.final.subject': 'התמונות הסופיות שלך אצל {business} מוכנות!',
  'mail.final.ready': 'התמונות הערוכות הסופיות שלך אצל <b>{business}</b> מוכנות! ✨',
  'mail.final.count': '{count} תמונות מחכות לך לצפייה ולהורדה, באותו קישור וקוד גישה שכבר יש לך.',

  'mail.summary.subject': 'הבחירה שלך אצל {business} נשלחה בהצלחה',
  'mail.summary.sent': 'הבחירה שלך אצל <b>{business}</b> נשלחה בהצלחה ✓ - {count} תמונות:',
  'mail.summary.next': 'אין צורך לעשות עוד כלום, הצלמת תיצור איתך קשר להמשך.',

  'mail.review.subject': 'אפשר לבקש ממך טובה קטנה, {name}?',
  'mail.review.hope': { f: 'מקווה שאת נהנית מהתמונות! 💛', m: 'מקווה שאתה נהנה מהתמונות! 💛' },
  'mail.review.ask': 'אם יש לך רגע, ביקורת קצרה ממך תעזור לי המון להמשיך לצלם עוד אירועים כמו שלך.',
  'mail.review.cta': 'כתיבת ביקורת',

  'mail.ext.subjectApproved': 'הגלריה הוארכה עד {date}',
  'mail.ext.subjectDeclined': 'עדכון לגבי בקשת ההארכה שלך',
  'mail.ext.subjectDeclinedAt': 'עדכון לגבי בקשת ההארכה שלך אצל {business}',
  'mail.ext.approved': 'הגלריה הוארכה עד <b>{date}</b> 💛',
  'mail.ext.approvedNext': 'אפשר להמשיך לבחור באותו קישור וקוד גישה.',
  'mail.ext.declined': 'הפעם לא ניתן להאריך את תקופת הבחירה - כדאי לסיים לבחור עד התאריך שנקבע. לשאלות אפשר להשיב למייל הזה.',

  'mail.anniv.subject': 'לפני שנה צילמנו 💛',
  'mail.anniv.memory': 'לפני כמעט שנה צילמנו יחד אצל <b>{business}</b> - ועדיין כיף לי להיזכר ברגעים האלה ✨',
  'mail.anniv.hope': { f: 'מקווה שאת עדיין נהנית מהתמונות 💛', m: 'מקווה שאתה עדיין נהנה מהתמונות 💛' },
  'mail.anniv.invite': 'אם בא לך לתאם צילום נוסף - משפחה, ילדים או סתם כי מתחשק - אשמח מאוד! אפשר פשוט להשיב למייל הזה.',
  'mail.anniv.cta': 'לצפייה בתמונות',

  'inv.hi': 'היי {name}! 📸',
  'inv.ready': 'הגלריה שלך עם התמונות מוכנה לבחירה.',
  'inv.link': 'קישור: {url}',
  'inv.codeLabel': '🔑 קוד גישה:',
  'inv.expiry': 'הגלריה פתוחה לבחירה עד {date}.',
  'inv.waiting': { f: 'מחכה לראות מה תבחרי! ✨', m: 'מחכה לראות מה תבחר! ✨' },
  'inv.yourGallery': 'הגלריה שלך',
} satisfies Record<string, Message>;
