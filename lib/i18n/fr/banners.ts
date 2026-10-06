// Français : bandeaux de la grille, remerciements, photos finales, filigrane.
import type { Section } from '../types';
import type { banners as he } from '../he/banners';

export const banners: Section<typeof he> = {
  'over.banner': '✨ Vous avez choisi {selected} photos ({included} incluses + {extra} en plus) · Supplément : {cost}',
  'over.bannerNoCost': '✨ Vous avez choisi {selected} photos ({included} incluses + {extra} en plus)',
  'resume.text': { f: '👋 Ravie de vous revoir ! Reprendre à la photo {n} ?', m: '👋 Ravi de vous revoir ! Reprendre à la photo {n} ?', n: '👋 Bon retour ! Reprendre à la photo {n} ?' },
  'resume.continue': 'Reprendre',
  'grid.hint': 'Touchez une photo pour l’agrandir · {heart} dans le coin pour choisir vite',
  'ro.ended': 'La période de sélection de cette galerie est terminée : vous pouvez encore voir les photos et télécharger celles qui ont été livrées.',
  'ro.endedWithDate': 'La période de sélection de cette galerie est terminée ({date}) : vous pouvez encore voir les photos et télécharger celles qui ont été livrées.',
  'ro.viewOnlyEnded': 'La période de sélection est terminée : consultation uniquement.',
  'ro.viewOnlySent': 'Votre sélection a été envoyée : consultation uniquement.',

  'thanks.title': 'Merci beaucoup{nameSuffix} !',
  'thanks.body': 'Votre sélection a bien été reçue ✨ Plus rien à faire : votre photographe voit déjà vos choix et reviendra vers vous pour la suite.',
  'thanks.bodyNamed': '{photographer} a bien reçu votre sélection ✨ Plus rien à faire : {photographer} voit déjà vos choix et reviendra vers vous pour la suite.',
  'thanks.viewOnly': '✓ Vous pouvez encore voir les photos ci-dessous, mais plus modifier la sélection.',
  'cele.done': '🎉 C’est terminé ! Votre photographe est en train d’être prévenu·e',

  'reveal.title': '✨ Vos photos sont prêtes',
  'reveal.sub': { one: '1 photo retouchée vous attend', other: '{count} photos retouchées vous attendent' },
  'reveal.cta': 'Voir mes photos',
  'dl.title': '💛 Vos photos finales sont prêtes !',
  'dl.sub': {
    one: '1 photo retouchée : vous pouvez la voir et la télécharger.',
    other: '{count} photos retouchées : à voir et télécharger une par une ou toutes ensemble.',
  },
  'dl.preparingZip': 'Préparation du ZIP...',
  'dl.zipAll': '📦 Tout télécharger en ZIP',
  'dl.zipFileName': 'photos-finales.zip',
  'dl.zipSummary': '{done} photos téléchargées sur {total}',
  'dl.zipPartial': '{done} photos téléchargées sur {total} : réessayez pour récupérer le reste',
  'dl.downloadAria': 'Télécharger {name}',
  'dl.downloadTitle': 'Télécharger la photo',
  'dl.downloading': 'Téléchargement...',
  'dl.download': '⬇ Télécharger',

  'wm.note': '🔒 Les photos sont affichées ici avec un filigrane. Vous recevrez les photos retouchées, sans filigrane, à la fin 💛',
};
