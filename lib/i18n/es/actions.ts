// Español: botones de acción, comparación, elección rápida.
import type { Section } from '../types';
import type { actions as he } from '../he/actions';

export const actions: Section<typeof he> = {
  'act.exitCompare': 'Salir de comparar',
  'act.compareMany': '⇄ Comparar varias fotos',
  'act.compareHint': 'Elige hasta {max} fotos para comparar ({count}/{max})',
  'act.compareNow': 'Comparar ahora ({count})',
  'act.slideshow': '▶ Ver en secuencia',
  'act.clearing': 'Borrando...',
  'act.clearAll': '🗑 Borrar todas mis elecciones',
  'act.clearConfirm': '¿Borrar todas tus elecciones en esta galería? No se puede deshacer.',
  'act.aiTitle': "Claude analiza hasta 60 fotos y marca las mejores como 'quizás': un punto de partida, no una elección final",
  'act.aiRunning': 'Analizando fotos...',
  'act.aiHelp': '🪄 Ayúdame a elegir',
  'act.aiPicked': 'Marqué {picked} de {analyzed} fotos analizadas como "quizás"; aún puedes cambiarlo todo',
  'act.aiNone': 'No encontré fotos que destaquen claramente; puede que ya las hayas marcado todas',
  'act.onlyOwnerFinal': 'Solo {owner} puede enviar la selección final; tus elecciones aquí son sugerencias para comentar.',

  'cmp.aria': 'Comparar fotos',
  'cmp.exit': 'Salir de comparar',
  'cmp.pick': 'Elegir esta ✓',

  'sw.summaryAria': 'Resumen de la elección rápida',
  'sw.doneSecond': '¡También terminaste la segunda ronda!',
  'sw.doneAll': '¡Ya viste todas las fotos!',
  'sw.maybePrompt': 'Marcaste {n} fotos como "quizás". ¿Quieres repasarlas y decidir?',
  'sw.secondPass': 'Sí, segunda ronda de "quizás" ({n})',
  'sw.noThanks': 'No, gracias, ya terminé',
  'sw.aria': 'Elección rápida: foto {i} de {total}',
  'sw.labelSecond': 'Segunda ronda · "quizás" · ',
  'sw.label': 'Elección rápida · ',
  'sw.closeAria': 'Cerrar elección rápida',
  'sw.skipAria': 'Saltar, sin cambiar la marca',
  'sw.skip': 'Saltar',
  'sw.maybeAria': 'Marcar como quizás',
  'sw.maybe': 'Quizás',
  'sw.pickAria': 'Elegir esta foto',
  'sw.picked': '¡Sí!',

  'status.selected': '✓ Elegida',
  'status.maybeMarked': '🤔 Marcada como quizás',
  'status.unmarked': 'Sin marcar',
  'status.selectedPlain': 'Elegida',
  'status.maybePlain': 'Marcada como quizás',
  'status.giftPlain': 'Foto de regalo, incluida automáticamente',
};
