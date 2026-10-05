// Español: avisos de la cuadrícula, pantalla de agradecimiento, fotos finales.
import type { Section } from '../types';
import type { banners as he } from '../he/banners';

export const banners: Section<typeof he> = {
  'over.banner': '✨ Elegiste {selected} fotos ({included} incluidas + {extra} extra) · Extra: {cost}',
  'gift.banner': {
    one: '🎁 Te preparé una foto de regalo: ya está incluida, sin descontar del paquete y sin coste extra. No hace falta elegirla.',
    other: '🎁 Te preparé {count} fotos de regalo: ya están incluidas, sin descontar del paquete y sin coste extra. No hace falta elegirlas.',
  },
  'hint.tap': '✨ Novedad: toca una foto para ampliarla y elige con los botones de abajo',
  'resume.text': { f: '👋 ¡Bienvenida de nuevo! ¿Seguimos desde la foto {n}?', m: '👋 ¡Bienvenido de nuevo! ¿Seguimos desde la foto {n}?', n: '👋 ¡Hola de nuevo! ¿Seguimos desde la foto {n}?' },
  'resume.continue': 'Continuar',
  'grid.hint': 'Toca una foto para verla en grande · {heart} en la esquina elige al instante',
  'ro.ended': 'El plazo para elegir en esta galería terminó; aún puedes ver las fotos y descargar las entregadas.',
  'ro.endedWithDate': 'El plazo para elegir en esta galería terminó ({date}); aún puedes ver las fotos y descargar las entregadas.',
  'ro.viewOnlyEnded': 'El plazo para elegir terminó: solo lectura.',
  'ro.viewOnlySent': 'Tu selección ya se envió: solo lectura.',

  'thanks.title': '¡Muchas gracias{nameSuffix}!',
  'thanks.body': 'Recibimos tu selección ✨ No tienes que hacer nada más: tu fotógrafa ya ve lo que elegiste y se pondrá en contacto contigo.',
  'thanks.bodyNamed': '{photographer} recibió tu selección ✨ No tienes que hacer nada más: {photographer} ya ve lo que elegiste y se pondrá en contacto contigo.',
  'thanks.viewOnly': '✓ Aún puedes ver las fotos abajo, pero ya no cambiar la selección.',
  'cele.done': '🎉 ¡Listo! Tu fotógrafa ya está recibiendo el aviso',

  'dl.title': '💛 ¡Tus fotos finales están listas!',
  'dl.sub': {
    one: '1 foto editada: puedes verla y descargarla.',
    other: '{count} fotos editadas: puedes verlas y descargarlas una a una o todas juntas.',
  },
  'dl.preparingZip': 'Preparando ZIP...',
  'dl.zipAll': '📦 Descargar todo en ZIP',
  'dl.zipFileName': 'fotos-finales.zip',
  'dl.zipSummary': 'Se descargaron {done} de {total} fotos',
  'dl.zipPartial': 'Se descargaron {done} de {total} fotos; inténtalo de nuevo para bajar el resto',
  'dl.downloadAria': 'Descargar {name}',
  'dl.downloadTitle': 'Descargar la foto',
  'dl.downloading': 'Descargando...',
  'dl.download': '⬇ Descargar',

  'wm.note': '🔒 Las fotos aquí se muestran con marca de agua. Recibirás las fotos limpias y editadas al final 💛',
};
