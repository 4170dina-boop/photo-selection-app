// Español: bienvenida, cabecera, aviso sin conexión, información del paquete.
import type { Section } from '../types';
import type { welcome as he } from '../he/welcome';

export const welcome: Section<typeof he> = {
  'welcome.title': { f: '¡Bienvenida{nameSuffix}!', m: '¡Bienvenido{nameSuffix}!', n: '¡Te damos la bienvenida{nameSuffix}!' },
  'welcome.ready': 'Tu galería está lista para elegir',
  'welcome.package': ': tu paquete incluye {n} fotos',
  'welcome.until': ', hasta el {date}',
  'welcome.end': '.',
  'welcome.tipOpen': '🔍 Toca una foto para verla en grande y elige con los botones de abajo',
  'welcome.tipCompare': '⇄ Puedes comparar varias fotos una al lado de otra',
  'welcome.tipNote': '✎ Puedes dejar una nota personal a tu fotógrafa en cada foto (desde la vista ampliada)',
  'welcome.gifts': {
    one: '🎁 También te espera una foto de regalo de mi parte, sin descontar de tu paquete',
    other: '🎁 También te esperan {count} fotos de regalo de mi parte, sin descontar de tu paquete',
  },
  'welcome.guestNote': '👀 Tus elecciones aquí son sugerencias para comentar; solo {owner} puede enviar la selección final',
  'welcome.start': '¡Empecemos! ✨',

  'hdr.connectedAs': { f: 'Conectada como {name}', m: 'Conectado como {name}', n: 'Sesión de {name}' },
  'hdr.family': ' (familia)',
  'hdr.compare': '⇄ Comparar',
  'hdr.exitCompare': '✕ Salir de comparar',
  'hdr.swipe': '⚡ Elección rápida',
  'hdr.exitSwipe': '✕ Salir de elección rápida',
  'hdr.more': '⋯ Más',
  'hdr.moreAria': 'Más acciones',
  'hdr.selectedInPackage': 'Elegidas del paquete',
  'hdr.viewed': 'Has visto {seen} de {total} fotos',
  'hdr.viewedAria': 'Fotos que ya viste',

  'off.noInternet': '📴 Sin conexión a internet: ',
  'off.pending': {
    one: '1 cambio pendiente se enviará automáticamente cuando vuelva la conexión.',
    other: '{count} cambios pendientes se enviarán automáticamente cuando vuelva la conexión.',
  },
  'off.keepGoing': 'Puedes seguir mirando y eligiendo; tus elecciones se enviarán cuando vuelva la conexión.',

  'info.packageIncludes': 'Tu paquete incluye {n} fotos',
  'info.remaining': ' · Te quedan {n} dentro del paquete',
  'info.extraPrice': '✨ Cada foto extra: {price}',
  'info.estimate': 'Total estimado: {total}',
  'info.estimateBreakdown': ' ({base} paquete + {extra} extras)',
  'info.agreedTotal': 'Total a pagar: {total}',
  'info.until': 'Puedes elegir hasta el {date}',
};
