// English: ready-made stage messages (lib/clientInviteMessage.ts).
import type { Section } from '../types';
import type { stages as he } from '../he/stages';

export const stages: Section<typeof he> = {
  'stg.hi.warm': 'Hi {name}! 💛',
  'stg.hi.formal': 'Hello {name},',
  'stg.reminder.warm': 'Just a gentle reminder - your photos are still waiting for you to pick your favorites 😊',
  'stg.reminder.formal': 'This is a reminder that your gallery is open for selection. We would appreciate it if you could complete your selection soon.',
  'stg.editing.warm': "I've started editing the photos you picked 💛 I'll let you know as soon as they're ready.",
  'stg.editing.formal': "We wanted to let you know that we've started editing your selected photos. We'll update you once they're ready.",
  'stg.reopened.warm': "Your gallery is open for selection again - feel free to go in, change and add whatever you like 😊",
  'stg.reopened.formal': 'Your gallery has been reopened for selection. You may now sign in and update your selection.',
  'stg.ready.warm': "Your photos are ready 🎉 {count} edited photos are waiting for you in the gallery - hope you love them!",
  'stg.ready.formal': 'Your final photos are ready 🎉 {count} photos are available to view and download in the gallery.',
  'stg.cta.view': 'View & download',
  'stg.signoff.warm': 'With love, {business}',
  'stg.signoff.formal': 'Kind regards, {business}',
};
