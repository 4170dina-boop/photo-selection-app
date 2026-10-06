// Français : écran du code d’accès et identification.
import type { Section } from '../types';
import type { access as he } from '../he/access';

export const access: Section<typeof he> = {
  'code.title': '✨ Saisissez le code d’accès que vous avez reçu',
  'code.enterCode': 'Saisissez votre code d’accès',
  'code.pasteAria': 'Coller le code d’accès depuis le presse-papiers',
  'code.paste': '📋 Coller',
  'code.checking': 'Vérification...',
  'code.enter': 'Entrer dans la galerie',
  'code.pasteNoCode': 'Aucun code trouvé dans le texte copié : vous pouvez le saisir à la main',
  'code.pasteFailed': 'Impossible de lire le presse-papiers : faites un appui long dans le champ pour coller',
  'code.authFailed': 'Une erreur est survenue, veuillez réessayer',
  'code.tooMany': 'Trop de tentatives : réessayez dans quelques minutes',
  'code.unavailable': 'Le service est indisponible pour le moment : réessayez dans un instant',
  'code.wrong': 'Code d’accès incorrect',

  'id.hi': '👋 Bonjour !',
  'id.hiName': '👋 Bonjour {name} !',
  'id.ownerEmailLabel': 'Juste pour vérifier : quelle est votre adresse e-mail ? (celle à laquelle votre photographe a envoyé l’invitation)',
  'id.confirmEnter': 'Confirmer et entrer',
  'id.whoIsIn': 'Qui consulte la galerie ?',
  'id.itsMe': 'Oui, c’est moi',
  'id.notMe': 'Non, je suis un proche (famille ou ami·e)',
  'id.nameLabel': 'Comment vous appelez-vous ?',
  'id.namePlaceholder': 'ex. : Mamie Ruth / Yossi (son mari)',
  'id.genderLabel': 'Comment souhaitez-vous qu’on s’adresse à vous ?',
  'id.genderF': '👩 Au féminin',
  'id.genderM': '👨 Au masculin',
  'id.joining': 'Connexion...',
  'id.join': 'Rejoindre la galerie',
};
