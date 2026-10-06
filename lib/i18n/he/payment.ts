// עברית: "💳 תשלום" ללקוחה - "איך נוח לך לשלם?" ובחירת אמצעי תשלום
// (components/ClientPayButton.tsx, lib/paymentMethods.ts).
import type { Message } from '../types';

export const payment = {
  'pay.title': '💳 תשלום: {amount} ₪',
  'pay.howToPay': 'איך נוח לך לשלם?',
  'pay.hint': 'הצלמת תעדכן כשהתשלום יתקבל.',
  'pay.method.bank': 'העברה בנקאית',
  'pay.method.cash': 'מזומן',
  'pay.method.check': "צ'ק",
  'pay.method.phone': 'תיאום טלפוני',
  'pay.method.bit': 'ביט',
  'pay.method.paybox': 'PayBox',
  'pay.cashDefault': 'אפשר לשלם לצלמת במזומן.',
  'pay.checkDefault': "אפשר לשלם לצלמת בצ'ק.",
  'pay.phoneHint': 'אפשר להתקשר לצלמת ולתאם את התשלום:',
  'pay.call': '📞 חיוג',
  'pay.copyAccount': 'העתקת מספר החשבון',
  'pay.copyAll': 'העתקת כל הפרטים',
  'pay.copyPhone': 'העתקת המספר',
  'pay.copied': '✓ הועתק',
  'pay.copyFailed': 'לא הצלחנו להעתיק - אפשר לסמן ולהעתיק ידנית',
  'pay.openBit': 'לתשלום בביט ↗',
  'pay.openPaybox': 'לתשלום ב-PayBox ↗',
  'pay.confirm': 'אישור ✓',
  'pay.saving': 'שומרים...',
  'pay.confirmed': '✓ נרשם: {method}. הצלמת תעדכן כשהתשלום יתקבל.',
  'pay.change': 'שינוי',
  'pay.choiceFailed': {
    f: 'שמירת הבחירה נכשלה - נסי שוב',
    m: 'שמירת הבחירה נכשלה - נסה שוב',
    n: 'שמירת הבחירה נכשלה - נסה/י שוב',
  },
} satisfies Record<string, Message>;
