// Español: palabras comunes y mensajes de error (tuteo, tono cercano).
import type { Section } from '../types';
import type { common as he } from '../he/common';

export const common: Section<typeof he> = {
  'common.loading': 'Cargando...',
  'common.loadingGallery': 'Cargando tu galería...',
  'common.back': 'Volver',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.close': 'Cerrar',
  'common.closeNotice': 'Cerrar aviso',
  'common.prev': 'Anterior',
  'common.next': 'Siguiente',
  'common.processing': 'Procesando...',
  'common.processingAria': 'La foto se está procesando',
  'common.processingStill': 'Esta foto todavía se está procesando',
  'common.photoN': 'Foto {n}',
  'common.photographer': 'tu fotógrafa',
  'common.ownerFallback': { f: 'la clienta principal', m: 'el cliente principal' },
  'common.language': 'Idioma',

  'err.noInternet': 'Sin conexión a internet. Revisa tu conexión e inténtalo de nuevo.',
  'err.offlineRetryLater': 'Ahora mismo no hay conexión: inténtalo de nuevo cuando vuelva.',
  'err.galleryExpired': 'Esta galería ha caducado',
  'err.loadFailed': 'No se pudo cargar la galería. Prueba a recargar la página.',
  'err.downloadFailed': 'No se pudo descargar la foto, inténtalo de nuevo',
  'err.zipFailed': 'No se pudo preparar el ZIP, inténtalo de nuevo',
  'err.updateNotSaved': 'El cambio no se guardó, inténtalo de nuevo.',
  'err.noteNotSaved': 'La nota no se guardó, inténtalo de nuevo.',
  'err.offlineNotSaved': 'Algunas elecciones que hiciste sin conexión no se guardaron; puede que la galería ya esté cerrada',
  'err.finishPendingOffline': 'Hay elecciones que aún no se guardaron (sin conexión). Tu selección se enviará cuando vuelva la conexión, o puedes intentarlo de nuevo.',
  'err.finishFailed': 'No se pudo enviar tu selección, inténtalo de nuevo.',
  'err.clearFailed': 'No se pudieron borrar tus elecciones, inténtalo de nuevo.',
  'err.aiFailed': 'El análisis falló, inténtalo de nuevo.',
  'err.identifyFailed': 'No se pudo entrar a la galería, inténtalo de nuevo',
};
