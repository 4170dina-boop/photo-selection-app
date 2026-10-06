// Français : barre du bas, récapitulatif, prix supplémentaire, prolongation, collage.
import type { Section } from '../types';
import type { finish as he } from '../he/finish';

export const finish: Section<typeof he> = {
  'bar.countdown': 'Votre sélection sera envoyée dans {n} secondes...',
  'bar.undo': 'Annuler l’envoi',
  'bar.notSent': 'Votre sélection n’a pas encore été envoyée.',
  'bar.sending': 'Envoi...',
  'bar.retry': 'Réessayer l’envoi',
  'bar.selected': 'choisies',
  'bar.extra': ' · +{n} en plus',
  'bar.needOne': 'Choisissez d’abord au moins une photo',
  'bar.finish': 'J’ai terminé ✓',

  'fm.title': 'Avant l’envoi à votre photographe ✨',
  'fm.selected': 'Choisies',
  'fm.included': 'Incluses dans le forfait',
  'fm.extra': 'Photos supplémentaires',
  'fm.gifts': '🎁 Photos cadeaux (incluses, sans supplément)',
  'fm.agreedTotal': 'Total à payer',
  'fm.remaining': 'Il vous reste {n} photos sans supplément',
  'fm.undecided': {
    one: '🤔 1 photo « peut-être » pas encore tranchée',
    other: '🤔 {count} photos « peut-être » pas encore tranchées',
  },
  'fm.review': 'Les revoir',
  'fm.pending': '{n} modifications ne sont pas encore enregistrées : elles seront envoyées d’abord.',
  'fm.noUndo': 'Après l’envoi, la sélection ne pourra plus être modifiée (vous aurez {n} secondes pour annuler).',
  'fm.send': 'Envoyer au photographe ✓',
  'fm.backToChoosing': 'Revenir au choix',
  'toast.extraPrice': '✨ Vous avez dépassé les {included} photos du forfait · Chaque photo supplémentaire : {price}',

  'ext.lastDay': '⏳ Aujourd’hui est le dernier jour pour choisir',
  'ext.daysLeft': { one: '⏳ Plus qu’1 jour pour choisir', other: '⏳ Plus que {count} jours pour choisir' },
  'ext.until': 'Vous pouvez choisir jusqu’au {date}',
  'ext.request': 'Demander un délai',
  'ext.howMany': 'Combien de jours en plus ?',
  'ext.daysOption': { one: '1 jour', other: '{count} jours' },
  'ext.sent': {
    one: 'Votre demande d’1 jour supplémentaire a été envoyée à votre photographe 💛',
    other: 'Votre demande de {count} jours supplémentaires a été envoyée à votre photographe 💛',
  },
  'ext.pending': {
    one: 'Vous avez demandé 1 jour de plus : votre photographe vous répondra bientôt',
    other: 'Vous avez demandé {count} jours de plus : votre photographe vous répondra bientôt',
  },
  'ext.limit': 'Vous avez déjà demandé un délai deux fois : pour toute question, contactez votre photographe',
  'ext.declined': 'La précédente demande de délai n’a pas été acceptée.',
  'ext.sendFailed': 'Impossible d’envoyer la demande, veuillez réessayer',
  'ext.sendFailedNet': 'Impossible d’envoyer la demande : vérifiez votre connexion et réessayez',

  'col.title': '🎁 Un collage cadeau de votre sélection',
  'col.sub': 'Nous avons réuni quelques-unes des photos que vous avez choisies, en souvenir',
  'col.rendering': 'Préparation du collage...',
  'col.unavailable': 'Impossible de préparer le collage pour le moment : réessayez plus tard.',
  'col.alt': 'Collage des photos que vous avez choisies',
  'col.download': '⬇️ Télécharger le collage souvenir',
  'col.share': '📱 Enregistrer sur le téléphone',
  'col.shareFailed': 'L’enregistrement a échoué : utilisez le bouton de téléchargement',
  'col.canvasTitle': 'Ma sélection ✨',
  'col.fileName': 'mon-collage',
};
