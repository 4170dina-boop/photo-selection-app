// Français : e-mails au client et message d’invitation à copier.
import type { Section } from '../types';
import type { emails as he } from '../he/emails';

export const emails: Section<typeof he> = {
  'mail.brand': 'Espace Photographes',
  'mail.footer': 'Envoyé via Espace Photographes ✨',
  'mail.codeLabel': 'Code d’accès',
  'mail.codeHint': 'Appui long sur le code pour le copier',
  'mail.enterCta': 'Entrer dans la galerie',
  'mail.hi': 'Bonjour {name},',

  'mail.invite.subject': 'Votre galerie chez {business} est prête !',
  'mail.invite.ready': 'Votre galerie chez <b>{business}</b> est prête : à vous de choisir vos photos ! ✨',
  'mail.invite.howto': 'Vous pouvez marquer chaque photo « peut-être » ou « choisie » et ajouter des notes. À la fin, appuyez sur « J’ai terminé » pour envoyer votre sélection.',

  'mail.reminder.subject': 'Rappel : votre galerie chez {business} ferme bientôt',
  'mail.reminder.expires': 'Votre galerie chez <b>{business}</b> ferme le <b>{date}</b>.',
  'mail.reminder.nudge': 'Si vous n’avez pas encore fini de choisir, c’est le moment 💛',

  'mail.final.subject': 'Vos photos finales chez {business} sont prêtes !',
  'mail.final.ready': 'Vos photos finales retouchées chez <b>{business}</b> sont prêtes ! ✨',
  'mail.final.count': '{count} photos vous attendent, à voir et télécharger avec le même lien et le même code d’accès.',

  'mail.summary.subject': 'Votre sélection a bien été envoyée à {business}',
  'mail.summary.sent': 'Votre sélection a bien été envoyée à <b>{business}</b> ✓ - {count} photos :',
  'mail.summary.next': 'Plus rien à faire : votre photographe reviendra vers vous pour la suite.',

  'mail.review.subject': 'Puis-je vous demander un petit service, {name} ?',
  'mail.review.hope': 'J’espère que les photos vous plaisent ! 💛',
  'mail.review.ask': 'Si vous avez un instant, un petit avis de votre part m’aiderait énormément à continuer de photographier des événements comme le vôtre.',
  'mail.review.cta': 'Laisser un avis',

  'mail.ext.subjectApproved': 'Votre sélection est prolongée jusqu’au {date}',
  'mail.ext.subjectDeclined': 'Des nouvelles de votre demande de délai',
  'mail.ext.subjectDeclinedAt': 'Des nouvelles de votre demande de délai chez {business}',
  'mail.ext.approved': 'Votre photographe a prolongé la sélection jusqu’au <b>{date}</b> 💛',
  'mail.ext.approvedNext': 'Vous pouvez continuer à choisir avec le même lien et le même code d’accès.',
  'mail.ext.declined': 'Cette fois, la période de sélection ne peut pas être prolongée : pensez à terminer avant la date prévue. Pour toute question, répondez simplement à cet e-mail.',

  'inv.hi': 'Bonjour {name} ! 📸',
  'inv.ready': 'Votre galerie photo est prête, à vous de choisir.',
  'inv.link': 'Lien : {url}',
  'inv.codeLabel': '🔑 Code d’accès :',
  'inv.expiry': 'La galerie est ouverte jusqu’au {date}.',
  'inv.waiting': 'J’ai hâte de voir vos choix ! ✨',
  'inv.yourGallery': 'Votre galerie',
};
