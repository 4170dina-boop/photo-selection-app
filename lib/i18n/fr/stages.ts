// Français : messages prêts par étape (lib/clientInviteMessage.ts).
import type { Section } from '../types';
import type { stages as he } from '../he/stages';

export const stages: Section<typeof he> = {
  'stg.hi.warm': 'Coucou {name} ! 💛',
  'stg.hi.formal': 'Bonjour {name},',
  'stg.reminder.warm': 'Petit rappel tout doux : vos photos attendent toujours que vous choisissiez vos préférées 😊',
  'stg.reminder.formal': 'Nous vous rappelons que votre galerie est ouverte à la sélection. Merci de compléter votre sélection dès que possible.',
  'stg.editing.warm': 'J’ai commencé à retoucher les photos que vous avez choisies 💛 Je vous préviens dès qu’elles sont prêtes.',
  'stg.editing.formal': 'Nous vous informons que la retouche des photos sélectionnées a commencé. Nous vous tiendrons informé(e) dès qu’elles seront prêtes.',
  'stg.reopened.warm': 'Votre galerie est de nouveau ouverte : vous pouvez entrer, modifier et ajouter ce que vous voulez 😊',
  'stg.reopened.formal': 'Votre galerie a été rouverte pour la sélection. Vous pouvez vous connecter et mettre à jour votre sélection.',
  'stg.ready.warm': 'Vos photos sont prêtes 🎉 {count} photos retouchées vous attendent dans la galerie - j’espère qu’elles vous plairont !',
  'stg.ready.formal': 'Vos photos finales sont prêtes 🎉 {count} photos sont disponibles à la consultation et au téléchargement dans la galerie.',
  'stg.cta.view': 'Voir et télécharger',
  'stg.signoff.warm': 'Avec tendresse, {business}',
  'stg.signoff.formal': 'Cordialement, {business}',
};
