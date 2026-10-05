// Français : vue agrandie, diaporama, note.
import type { Section } from '../types';
import type { enlarged as he } from '../he/enlarged';

export const enlarged: Section<typeof he> = {
  'en.aria': 'Vue agrandie : photo {n}',
  'en.kbd': 'Flèches pour passer d’une photo à l’autre, Échap pour fermer',
  'en.kbdMark': '. Touche S : je la veux, touche M : peut-être',
  'en.zoomTitle': 'Clic ou molette pour zoomer/dézoomer',
  'en.counter': 'Photo {current} / {total}',
  'en.selected': 'Choisies',
  'en.extra': '+{n} en plus',
  'en.extraCost': ' (supplément {cost})',
  'en.guestMine': 'Vos choix (suggestions) : {n}',
  'en.othersPicked': {
    one: '💞 {names} a aussi choisi cette photo',
    other: '💞 {names} ont aussi choisi cette photo',
  },
  'en.noteEditAria': 'Modifier la note au photographe sur cette photo',
  'en.noteAddAria': 'Ajouter une note au photographe sur cette photo',
  'en.noteEdit': '✎ Modifier la note',
  'en.noteAdd': '✎ Note au photographe',
  'en.wantTitle': 'Je la veux (touche S)',
  'en.want': '✓ Je la veux',
  'en.wantOn': 'Choisie · touchez à nouveau pour annuler',
  'en.maybeTitle': 'Peut-être (touche M)',
  'en.maybe': '🤔 Peut-être',
  'en.maybeOn': 'Marquée',
  'en.giftFromMe': '🎁 Un cadeau de ma part',
  'en.giftIncluded': ' : incluse automatiquement, inutile de la choisir',

  'ss.aria': 'Diaporama : photo {i} sur {total}',
  'ss.exitTitle': 'Quitter le diaporama',
  'ss.exit': '✕ Quitter',
  'ss.maybeOn': '✓ Peut-être',
  'ss.maybeOff': '? Peut-être',
  'ss.selectedOn': '✓ Choisie',
  'ss.select': '✓ Choisir',
  'ss.giftIncluded': '🎁 Un cadeau de ma part, inclus automatiquement',

  'note.title': 'Note sur la photo',
  'note.reply': 'Réponse de {name} :',
  'note.placeholder': 'ex. : celle-ci, je la voudrais en noir et blanc',
};
