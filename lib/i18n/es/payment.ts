// Español: "💳 Pago" - selector "¿Cómo prefieres pagar?" (components/ClientPayButton.tsx).
import type { Section } from '../types';
import type { payment as he } from '../he/payment';

export const payment: Section<typeof he> = {
  'pay.title': '💳 Pago: {amount} ₪',
  'pay.howToPay': '¿Cómo prefieres pagar?',
  'pay.hint': 'La fotógrafa te confirmará cuando reciba el pago.',
  'pay.method.bank': 'Transferencia bancaria',
  'pay.method.cash': 'Efectivo',
  'pay.method.check': 'Cheque',
  'pay.method.phone': 'Coordinar por teléfono',
  'pay.method.bit': 'Bit',
  'pay.method.paybox': 'PayBox',
  'pay.cashDefault': 'Puedes pagarle a la fotógrafa en efectivo.',
  'pay.checkDefault': 'Puedes pagarle a la fotógrafa con cheque.',
  'pay.phoneHint': 'Llama a la fotógrafa para coordinar el pago:',
  'pay.call': '📞 Llamar',
  'pay.copyAccount': 'Copiar número de cuenta',
  'pay.copyAll': 'Copiar todos los datos',
  'pay.copyPhone': 'Copiar número',
  'pay.copied': '✓ Copiado',
  'pay.copyFailed': 'No se pudo copiar; puedes seleccionarlo y copiarlo a mano',
  'pay.openBit': 'Pagar con Bit ↗',
  'pay.openPaybox': 'Pagar con PayBox ↗',
  'pay.confirm': 'Confirmar ✓',
  'pay.saving': 'Guardando...',
  'pay.confirmed': '✓ Anotado: {method}. La fotógrafa te confirmará cuando reciba el pago.',
  'pay.change': 'Cambiar',
  'pay.choiceFailed': 'No se pudo guardar tu elección, inténtalo de nuevo',
};
