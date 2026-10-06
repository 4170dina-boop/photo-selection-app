// Français : boutons d’action, comparaison, choix rapide.
import type { Section } from '../types';
import type { actions as he } from '../he/actions';

export const actions: Section<typeof he> = {
  'act.exitCompare': 'Quitter la comparaison',
  'act.compareHint': 'Choisissez jusqu’à {max} photos à comparer ({count}/{max})',
  'act.compareNow': 'Comparer maintenant ({count})',
  'act.slideshow': '▶ Diaporama',
  'act.clearing': 'Effacement...',
  'act.clearAll': '🗑 Effacer tous mes choix',
  'act.clearConfirm': 'Effacer tous vos choix dans cette galerie ? Cette action est irréversible.',
  'act.aiTitle': 'Claude analyse jusqu’à 60 photos et marque les meilleures en « peut-être » : un point de départ, pas un choix définitif',
  'act.aiRunning': 'Analyse des photos...',
  'act.aiHelp': '🪄 Aidez-moi à choisir',
  'act.aiPicked': 'J’ai marqué {picked} photos sur {analyzed} analysées en « peut-être » : vous pouvez encore tout changer',
  'act.aiNone': 'Je n’ai pas trouvé de photos qui se démarquent nettement : vous les avez peut-être déjà toutes marquées',
  'act.onlyOwnerFinal': {
    f: 'Seule {owner} peut valider la sélection finale : vos choix ici sont des suggestions à discuter.',
    m: 'Seul {owner} peut valider la sélection finale : vos choix ici sont des suggestions à discuter.',
  },

  'cmp.aria': 'Comparer les photos',
  'cmp.exit': 'Quitter la comparaison',
  'cmp.pick': 'Choisir celle-ci ✓',

  'sw.summaryAria': 'Résumé du choix rapide',
  'sw.doneSecond': 'Vous avez aussi terminé le deuxième tour !',
  'sw.doneAll': 'Vous avez parcouru toutes les photos !',
  'sw.maybePrompt': 'Vous avez marqué {n} photos en « peut-être » : voulez-vous les revoir pour trancher ?',
  'sw.secondPass': 'Oui, deuxième tour sur les « peut-être » ({n})',
  'sw.noThanks': 'Non merci, j’ai terminé',
  'sw.aria': 'Choix rapide : photo {i} sur {total}',
  'sw.labelSecond': 'Deuxième tour · « peut-être » · ',
  'sw.label': 'Choix rapide · ',
  'sw.closeAria': 'Fermer le choix rapide',
  'sw.skipAria': 'Passer, sans changer le marquage',
  'sw.skip': 'Passer',
  'sw.maybeAria': 'Marquer en peut-être',
  'sw.maybe': 'Peut-être',
  'sw.pickAria': 'Choisir cette photo',
  'sw.picked': 'Oui !',

  'status.selected': '✓ Choisie',
  'status.maybeMarked': '🤔 Marquée peut-être',
  'status.unmarked': 'Non marquée',
  'status.selectedPlain': 'Choisie',
  'status.maybePlain': 'Marquée peut-être',
  'status.giftPlain': 'Photo cadeau, incluse automatiquement',
};
