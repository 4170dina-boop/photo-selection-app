// Français : « 💳 Paiement » - choix « Comment préférez-vous payer ? » (components/ClientPayButton.tsx).
import type { Section } from '../types';
import type { payment as he } from '../he/payment';

export const payment: Section<typeof he> = {
  'pay.title': '💳 Paiement : {amount} ₪',
  'pay.howToPay': 'Comment préférez-vous payer ?',
  'pay.hint': 'La photographe confirmera dès réception du paiement.',
  'pay.method.bank': 'Virement bancaire',
  'pay.method.cash': 'Espèces',
  'pay.method.check': 'Chèque',
  'pay.method.phone': 'Par téléphone',
  'pay.method.bit': 'Bit',
  'pay.method.paybox': 'PayBox',
  'pay.cashDefault': 'Vous pouvez payer la photographe en espèces.',
  'pay.checkDefault': 'Vous pouvez payer la photographe par chèque.',
  'pay.phoneHint': 'Appelez la photographe pour convenir du paiement :',
  'pay.call': '📞 Appeler',
  'pay.copyAccount': 'Copier le numéro de compte',
  'pay.copyAll': 'Copier toutes les coordonnées',
  'pay.copyPhone': 'Copier le numéro',
  'pay.copied': '✓ Copié',
  'pay.copyFailed': 'Impossible de copier : sélectionnez et copiez manuellement',
  'pay.openBit': 'Payer avec Bit ↗',
  'pay.openPaybox': 'Payer avec PayBox ↗',
  'pay.confirm': 'Confirmer ✓',
  'pay.saving': 'Enregistrement...',
  'pay.confirmed': '✓ Noté : {method}. La photographe confirmera dès réception du paiement.',
  'pay.change': 'Modifier',
  'pay.choiceFailed': 'Impossible d’enregistrer votre choix, veuillez réessayer',
};
