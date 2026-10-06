// Español: correos al cliente y mensaje de invitación para copiar.
import type { Section } from '../types';
import type { emails as he } from '../he/emails';

export const emails: Section<typeof he> = {
  'mail.brand': 'Zona de Fotógrafos',
  'mail.footer': 'Enviado a través de Zona de Fotógrafos ✨',
  'mail.codeLabel': 'Código de acceso',
  'mail.codeHint': 'Mantén pulsado el código para copiarlo',
  'mail.enterCta': 'Entrar a la galería',
  'mail.hi': 'Hola {name}:',

  'mail.invite.subject': '¡Tu galería de {business} está lista!',
  'mail.invite.ready': '¡Tu galería de <b>{business}</b> está lista para que elijas tus fotos! ✨',
  'mail.invite.howto': 'Puedes marcar cada foto como "quizás" o "elegida" y añadir notas. Al final, pulsa "Terminé" para enviar tu selección.',

  'mail.reminder.subject': 'Recordatorio: tu galería de {business} cierra pronto',
  'mail.reminder.expires': 'Tu galería de <b>{business}</b> cierra el <b>{date}</b>.',
  'mail.reminder.nudge': 'Si aún no terminaste de elegir, este es el momento 💛',

  'mail.final.subject': '¡Tus fotos finales de {business} están listas!',
  'mail.final.ready': '¡Tus fotos finales editadas de <b>{business}</b> están listas! ✨',
  'mail.final.count': '{count} fotos te esperan para verlas y descargarlas, con el mismo enlace y código de acceso que ya tienes.',

  'mail.summary.subject': 'Tu selección se envió a {business}',
  'mail.summary.sent': 'Tu selección se envió a <b>{business}</b> ✓ - {count} fotos:',
  'mail.summary.next': 'No tienes que hacer nada más: tu fotógrafa se pondrá en contacto contigo.',

  'mail.review.subject': '¿Te puedo pedir un pequeño favor, {name}?',
  'mail.review.hope': '¡Espero que estés disfrutando las fotos! 💛',
  'mail.review.ask': 'Si tienes un momento, una reseña corta me ayudaría muchísimo a seguir fotografiando eventos como el tuyo.',
  'mail.review.cta': 'Escribir una reseña',

  'mail.ext.subjectApproved': 'Tu plazo para elegir se amplió hasta el {date}',
  'mail.ext.subjectDeclined': 'Novedades sobre tu solicitud de prórroga',
  'mail.ext.subjectDeclinedAt': 'Novedades sobre tu solicitud de prórroga en {business}',
  'mail.ext.approved': 'Tu fotógrafa amplió el plazo para elegir hasta el <b>{date}</b> 💛',
  'mail.ext.approvedNext': 'Puedes seguir eligiendo con el mismo enlace y código de acceso.',
  'mail.ext.declined': 'Esta vez no es posible ampliar el plazo; te recomendamos terminar de elegir antes de la fecha fijada. Si tienes dudas, responde a este correo.',

  'mail.anniv.subject': 'Hace un año hicimos una sesión de fotos 💛',
  'mail.anniv.memory': 'Hace casi un año hicimos juntos una sesión de fotos con <b>{business}</b>, y todavía me encanta recordar esos momentos ✨',
  'mail.anniv.hope': 'Espero que sigas disfrutando las fotos 💛',
  'mail.anniv.invite': 'Si te apetece reservar otra sesión (familia, niños o simplemente porque sí), ¡me encantaría! Solo tienes que responder a este correo.',
  'mail.anniv.cta': 'Ver las fotos',

  'inv.hi': '¡Hola {name}! 📸',
  'inv.ready': 'Tu galería de fotos está lista para que elijas.',
  'inv.link': 'Enlace: {url}',
  'inv.codeLabel': '🔑 Código de acceso:',
  'inv.expiry': 'La galería está abierta para elegir hasta el {date}.',
  'inv.waiting': '¡Qué ganas de ver lo que eliges! ✨',
  'inv.yourGallery': 'Tu galería',
};
