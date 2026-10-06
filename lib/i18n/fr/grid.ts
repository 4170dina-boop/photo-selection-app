// Français : filtres, notification « choisir ensemble », cartes de la grille.
import type { Section } from '../types';
import type { grid as he } from '../he/grid';

export const grid: Section<typeof he> = {
  'f.all': 'Toutes ({n})',
  'f.selected': 'Choisies ({n})',
  'f.maybe': 'Peut-être ({n})',
  'f.together': '💞 Choisies par tous ({n})',
  'f.only': 'Seulement {name} ({n})',
  'f.onlyMe': 'Seulement moi ({n})',
  'grid.empty': 'Aucune photo pour ce filtre.',

  'toast.othersItem': {
    one: '{name} a marqué une nouvelle photo',
    other: '{name} a marqué {count} nouvelles photos',
  },

  'card.compareOn': 'sélectionnée pour comparer',
  'card.compareOff': 'non sélectionnée pour comparer',
  'card.open': 'Ouvrir {label}',
  'card.hasNote': ', avec une note',
  'card.badgeMaybe': '🤔 Peut-être',
  'card.blurAria': 'La photo n’est peut-être pas nette (estimation automatique)',
  'card.blurTitle': 'Estimation automatique de la netteté : pas toujours exacte',
  'card.blurLabel': '💡 Peut-être floue',
  'card.markSelected': 'choisie',
  'card.markMaybe': 'peut-être',
  'card.giftTitle': 'Photo cadeau : incluse automatiquement, non décomptée du forfait et sans supplément',
  'card.giftFooter': 'Incluse automatiquement · non décomptée du forfait',
  'card.heartAria': 'Choisir {label}',
  'card.heartOn': 'Retirer le choix',
  'card.heartOff': 'Choisir cette photo',
  'card.noteTitle': 'Cette photo a une note',
};
