// English: client "💳 Payment" - "How would you like to pay?" method chooser.
import type { Section } from '../types';
import type { payment as he } from '../he/payment';

export const payment: Section<typeof he> = {
  'pay.title': '💳 Payment: ₪{amount}',
  'pay.howToPay': 'How would you like to pay?',
  'pay.hint': 'Your photographer will confirm once the payment arrives.',
  'pay.method.bank': 'Bank transfer',
  'pay.method.cash': 'Cash',
  'pay.method.check': 'Check',
  'pay.method.phone': 'Arrange by phone',
  'pay.method.bit': 'Bit',
  'pay.method.paybox': 'PayBox',
  'pay.cashDefault': 'You can pay your photographer in cash.',
  'pay.checkDefault': 'You can pay your photographer by check.',
  'pay.phoneHint': 'Call your photographer to arrange the payment:',
  'pay.call': '📞 Call',
  'pay.copyAccount': 'Copy account number',
  'pay.copyAll': 'Copy all details',
  'pay.copyPhone': 'Copy number',
  'pay.copied': '✓ Copied',
  'pay.copyFailed': "Couldn't copy - you can select and copy it manually",
  'pay.openBit': 'Pay with Bit ↗',
  'pay.openPaybox': 'Pay with PayBox ↗',
  'pay.confirm': 'Confirm ✓',
  'pay.saving': 'Saving...',
  'pay.confirmed': '✓ Noted: {method}. Your photographer will confirm once the payment arrives.',
  'pay.change': 'Change',
  'pay.choiceFailed': "Couldn't save your choice - please try again",
};
