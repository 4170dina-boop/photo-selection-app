// Français : accueil, en-tête, bandeau hors ligne, infos du forfait.
import type { Section } from '../types';
import type { welcome as he } from '../he/welcome';

export const welcome: Section<typeof he> = {
  'welcome.title': 'Bienvenue{nameSuffix} !',
  'welcome.ready': 'Votre galerie est prête',
  'welcome.package': ' : votre forfait comprend {n} photos',
  'welcome.until': ', jusqu’au {date}',
  'welcome.end': '.',
  'welcome.gifts': {
    one: '🎁 Une photo cadeau de ma part vous attend aussi, sans être décomptée du forfait',
    other: '🎁 {count} photos cadeaux de ma part vous attendent aussi, sans être décomptées du forfait',
  },
  'welcome.start': 'C’est parti ✨',

  'hdr.connectedAs': { f: 'Connectée en tant que {name}', m: 'Connecté en tant que {name}', n: 'Connecté·e en tant que {name}' },
  'hdr.family': ' (famille)',
  'hdr.compare': '⇄ Comparer',
  'hdr.exitCompare': '✕ Quitter la comparaison',
  'hdr.swipe': '⚡ Choix rapide',
  'hdr.exitSwipe': '✕ Quitter le choix rapide',
  'hdr.more': '⋯ Plus',
  'hdr.moreAria': 'Plus d’actions',
  'hdr.selectedInPackage': 'Choisies dans le forfait',
  'hdr.viewed': 'Vous avez vu {seen} photos sur {total}',
  'hdr.viewedAria': 'Photos déjà vues',

  'off.noInternet': '📴 Pas de connexion internet - ',
  'off.pending': {
    one: '1 modification en attente sera envoyée automatiquement au retour de la connexion.',
    other: '{count} modifications en attente seront envoyées automatiquement au retour de la connexion.',
  },
  'off.keepGoing': 'Vous pouvez continuer à parcourir et choisir : vos choix seront envoyés au retour de la connexion.',

  'info.packageIncludes': 'Votre forfait comprend {n} photos',
  'info.remaining': ' · Il vous en reste {n} dans le forfait',
  'info.extraPrice': '✨ Chaque photo supplémentaire : {price}',
  'info.estimate': 'Total estimé : {total}',
  'info.estimateBreakdown': ' ({base} forfait + {extra} suppléments)',
  'info.agreedTotal': 'Total à payer : {total}',
  'info.until': 'Vous pouvez choisir jusqu’au {date}',
};
