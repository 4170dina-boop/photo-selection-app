// Español: barra inferior, resumen final, aviso de precio extra, prórroga, collage.
import type { Section } from '../types';
import type { finish as he } from '../he/finish';

export const finish: Section<typeof he> = {
  'bar.countdown': 'Tu selección se enviará en {n} segundos...',
  'bar.undo': 'Deshacer envío',
  'bar.notSent': 'Tu selección aún no se envió.',
  'bar.sending': 'Enviando...',
  'bar.retry': 'Intentar enviar de nuevo',
  'bar.selected': 'elegidas',
  'bar.extra': ' · +{n} extra',
  'bar.needOne': 'Elige al menos una foto primero',
  'bar.finish': 'Terminé ✓',

  'fm.title': 'Antes de enviarlo a tu fotógrafa ✨',
  'fm.selected': 'Elegidas',
  'fm.included': 'Incluidas en el paquete',
  'fm.extra': 'Fotos extra',
  'fm.gifts': '🎁 Fotos de regalo (incluidas, sin coste)',
  'fm.remaining': 'Aún te quedan {n} fotos sin coste extra',
  'fm.undecided': {
    one: '🤔 1 foto en "quizás" sin decidir',
    other: '🤔 {count} fotos en "quizás" sin decidir',
  },
  'fm.review': 'Repasarlas',
  'fm.pending': 'Hay {n} cambios sin guardar; se enviarán primero.',
  'fm.noUndo': 'Después de enviar no podrás cambiar la selección (tendrás {n} segundos para deshacer).',
  'fm.send': 'Enviar a la fotógrafa ✓',
  'fm.backToChoosing': 'Volver a elegir',
  'toast.extraPrice': '✨ Pasaste las {included} fotos del paquete · Cada foto extra: {price}',

  'ext.lastDay': '⏳ Hoy es el último día para elegir',
  'ext.daysLeft': { one: '⏳ Queda 1 día para elegir', other: '⏳ Quedan {count} días para elegir' },
  'ext.until': 'Puedes elegir hasta el {date}',
  'ext.request': 'Pedir más tiempo',
  'ext.howMany': '¿Cuántos días más?',
  'ext.daysOption': { one: '1 día', other: '{count} días' },
  'ext.sent': {
    one: 'Tu solicitud de 1 día más se envió a tu fotógrafa 💛',
    other: 'Tu solicitud de {count} días más se envió a tu fotógrafa 💛',
  },
  'ext.pending': {
    one: 'Pediste 1 día más; tu fotógrafa te responderá pronto',
    other: 'Pediste {count} días más; tu fotógrafa te responderá pronto',
  },
  'ext.limit': 'Ya pediste más tiempo dos veces; para cualquier duda, escribe a tu fotógrafa',
  'ext.declined': 'La solicitud anterior de prórroga no fue aprobada.',
  'ext.sendFailed': 'No se pudo enviar la solicitud, inténtalo de nuevo',
  'ext.sendFailedNet': 'No se pudo enviar la solicitud: revisa tu conexión e inténtalo de nuevo',

  'col.title': '🎁 Un collage de regalo con tu selección',
  'col.sub': 'Juntamos algunas de las fotos que elegiste, de recuerdo',
  'col.rendering': 'Preparando el collage...',
  'col.unavailable': 'No pudimos preparar el collage ahora; inténtalo más tarde.',
  'col.alt': 'Collage con las fotos que elegiste',
  'col.download': '⬇️ Descargar el collage',
  'col.share': '📱 Guardar en el móvil',
  'col.shareFailed': 'No se pudo guardar; puedes usar el botón de descarga',
  'col.canvasTitle': 'Mi selección ✨',
  'col.fileName': 'mi-collage',
};
