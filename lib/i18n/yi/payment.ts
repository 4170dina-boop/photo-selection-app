// יידיש: "💳 באצאָלן" - "ווי איז אייך באקוועם צו באצאָלן?" (components/ClientPayButton.tsx).
import type { Section } from '../types';
import type { payment as he } from '../he/payment';

export const payment: Section<typeof he> = {
  'pay.title': '💳 באצאָלן: {amount} ₪',
  'pay.howToPay': 'ווי איז אייך באקוועם צו באצאָלן?',
  'pay.hint': 'די פאטאגראפין וועט מודיע זיין ווען די צאָלונג איז אנגעקומען.',
  'pay.method.bank': 'באנק איבערפירונג',
  'pay.method.cash': 'מזומן',
  'pay.method.check': 'טשעק',
  'pay.method.phone': 'אפמאכן איבערן טעלעפאן',
  'pay.method.bit': 'ביט',
  'pay.method.paybox': 'PayBox',
  'pay.cashDefault': 'מען קען באצאָלן די פאטאגראפין מיט מזומן.',
  'pay.checkDefault': 'מען קען באצאָלן די פאטאגראפין מיט א טשעק.',
  'pay.phoneHint': 'מען קען רופן די פאטאגראפין און אפמאכן די צאָלונג:',
  'pay.call': '📞 רופן',
  'pay.copyAccount': 'קאפירן דעם קאנטע נומער',
  'pay.copyAll': 'קאפירן אלע פרטים',
  'pay.copyPhone': 'קאפירן דעם נומער',
  'pay.copied': '✓ קאפירט',
  'pay.copyFailed': 'מען האט נישט געקענט קאפירן - מען קען עס אנצייכענען און קאפירן אליין',
  'pay.openBit': 'באצאָלן מיט ביט ↗',
  'pay.openPaybox': 'באצאָלן מיט PayBox ↗',
  'pay.confirm': 'באשטעטיגן ✓',
  'pay.saving': 'היט אפ...',
  'pay.confirmed': '✓ פארצייכנט: {method}. די פאטאגראפין וועט מודיע זיין ווען די צאָלונג איז אנגעקומען.',
  'pay.change': 'טוישן',
  'pay.choiceFailed': 'מען האט נישט געקענט אפהיטן די ברירה - פרובירט נאכאמאל',
};
