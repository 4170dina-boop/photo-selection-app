// Español: mensajes listos por etapa (lib/clientInviteMessage.ts).
import type { Section } from '../types';
import type { stages as he } from '../he/stages';

export const stages: Section<typeof he> = {
  'stg.hi.warm': '¡Hola {name}! 💛',
  'stg.hi.formal': 'Hola {name}:',
  'stg.reminder.warm': 'Solo un pequeño recordatorio: tus fotos siguen esperando a que elijas tus favoritas 😊',
  'stg.reminder.formal': 'Le recordamos que su galería está abierta para la selección. Le agradeceríamos que completara su selección pronto.',
  'stg.editing.warm': 'Ya empecé a editar las fotos que elegiste 💛 Te aviso en cuanto estén listas.',
  'stg.editing.formal': 'Queremos informarle que hemos comenzado a editar las fotos seleccionadas. Le avisaremos cuando estén listas.',
  'stg.reopened.warm': 'Tu galería está abierta de nuevo para elegir: puedes entrar, cambiar y añadir lo que quieras 😊',
  'stg.reopened.formal': 'Su galería se ha reabierto para la selección. Puede entrar y actualizar su selección.',
  'stg.ready.warm': '¡Tus fotos están listas 🎉! {count} fotos editadas te esperan en la galería. ¡Espero que te encanten!',
  'stg.ready.formal': 'Sus fotos finales están listas 🎉 {count} fotos están disponibles para ver y descargar en la galería.',
  'stg.cta.view': 'Ver y descargar',
  'stg.signoff.warm': 'Con cariño, {business}',
  'stg.signoff.formal': 'Saludos cordiales, {business}',
};
