// Español: pantalla del código de acceso e identificación.
import type { Section } from '../types';
import type { access as he } from '../he/access';

export const access: Section<typeof he> = {
  'code.title': '✨ Introduce el código de acceso que recibiste',
  'code.enterCode': 'Introduce el código de acceso',
  'code.pasteAria': 'Pegar el código de acceso del portapapeles',
  'code.paste': '📋 Pegar',
  'code.checking': 'Comprobando...',
  'code.enter': 'Entrar a la galería',
  'code.pasteNoCode': 'No encontramos un código en lo que copiaste; puedes escribirlo a mano',
  'code.pasteFailed': 'No pudimos leer el portapapeles; mantén pulsado el campo para pegar',
  'code.authFailed': 'Algo salió mal, inténtalo de nuevo',
  'code.tooMany': 'Demasiados intentos; vuelve a intentarlo en unos minutos',
  'code.unavailable': 'El servicio no está disponible ahora; inténtalo en un momento',
  'code.wrong': 'Código de acceso incorrecto',

  'id.hi': '👋 ¡Hola!',
  'id.hiName': '👋 ¡Hola, {name}!',
  'id.ownerEmailLabel': 'Solo para confirmar: ¿cuál es tu correo? (al que tu fotógrafa envió la invitación)',
  'id.confirmEnter': 'Confirmar y entrar',
  'id.whoIsIn': '¿Quién está viendo la galería?',
  'id.itsMe': 'Sí, soy yo',
  'id.notMe': 'No, soy familiar o amigo/a',
  'id.nameLabel': '¿Cómo te llamas?',
  'id.namePlaceholder': 'p. ej.: Abuela Rut / Josué (su marido)',
  'id.genderLabel': '¿Cómo prefieres que te hablemos?',
  'id.genderF': '👩 En femenino',
  'id.genderM': '👨 En masculino',
  'id.joining': 'Entrando...',
  'id.join': 'Unirme a la galería',
};
