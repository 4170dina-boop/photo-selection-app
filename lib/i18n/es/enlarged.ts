// Español: vista ampliada, secuencia, nota.
import type { Section } from '../types';
import type { enlarged as he } from '../he/enlarged';

export const enlarged: Section<typeof he> = {
  'en.aria': 'Vista ampliada: foto {n}',
  'en.kbd': 'Flechas para pasar de foto, Escape para cerrar',
  'en.kbdMark': '. Tecla S: la quiero, tecla M: quizás',
  'en.zoomTitle': 'Clic o rueda del ratón para acercar/alejar',
  'en.counter': 'Foto {current} / {total}',
  'en.selected': 'Elegidas',
  'en.extra': '+{n} extra',
  'en.extraCost': ' (extra {cost})',
  'en.guestMine': 'Tus elecciones (solo sugerencias): {n}',
  'en.othersPicked': {
    one: '💞 {names} también eligió esta foto',
    other: '💞 {names} también eligieron esta foto',
  },
  'en.noteEditAria': 'Editar la nota a la fotógrafa sobre esta foto',
  'en.noteAddAria': 'Añadir una nota a la fotógrafa sobre esta foto',
  'en.noteEdit': '✎ Editar nota a la fotógrafa',
  'en.noteAdd': '✎ Nota a la fotógrafa',
  'en.wantTitle': 'La quiero (tecla S)',
  'en.want': '✓ La quiero',
  'en.wantOn': 'Elegida · toca de nuevo para quitar',
  'en.maybeTitle': 'Quizás (tecla M)',
  'en.maybe': '🤔 Quizás',
  'en.maybeOn': 'Marcada',
  'en.giftFromMe': '🎁 Un regalo de mi parte',
  'en.giftIncluded': ': incluida automáticamente, no hace falta elegirla',

  'ss.aria': 'Secuencia: foto {i} de {total}',
  'ss.exitTitle': 'Salir de la secuencia',
  'ss.exit': '✕ Salir',
  'ss.maybeOn': '✓ Quizás',
  'ss.maybeOff': '? Quizás',
  'ss.selectedOn': '✓ Elegida',
  'ss.select': '✓ Elegir',
  'ss.giftIncluded': '🎁 Un regalo de mi parte, incluido automáticamente',

  'note.title': 'Nota sobre la foto',
  'note.reply': 'Respuesta de {name}:',
  'note.placeholder': 'p. ej.: esta la quiero en blanco y negro',
};
