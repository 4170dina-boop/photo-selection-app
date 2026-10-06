// English: client emails and the copyable invite message.
import type { Section } from '../types';
import type { emails as he } from '../he/emails';

export const emails: Section<typeof he> = {
  'mail.brand': 'Photographers Zone',
  'mail.footer': 'Sent via Photographers Zone ✨',
  'mail.codeLabel': 'Access code',
  'mail.codeHint': 'Long-press the code to copy it',
  'mail.enterCta': 'Open gallery',
  'mail.hi': 'Hi {name},',

  'mail.invite.subject': 'Your gallery from {business} is ready!',
  'mail.invite.ready': 'Your gallery from <b>{business}</b> is ready for you to choose your photos! ✨',
  'mail.invite.howto': 'Mark any photo as "maybe" or "selected" and add notes. When you\'re done, tap "I\'m done" to send your selection.',

  'mail.reminder.subject': 'Reminder: your gallery from {business} is closing soon',
  'mail.reminder.expires': 'Your gallery from <b>{business}</b> closes on <b>{date}</b>.',
  'mail.reminder.nudge': "If you haven't finished choosing yet, now's the time 💛",

  'mail.final.subject': 'Your final photos from {business} are ready!',
  'mail.final.ready': 'Your final edited photos from <b>{business}</b> are ready! ✨',
  'mail.final.count': '{count} photos are waiting for you to view and download, using the same link and access code you already have.',

  'mail.summary.subject': 'Your selection was sent to {business}',
  'mail.summary.sent': 'Your selection was sent to <b>{business}</b> ✓ - {count} photos:',
  'mail.summary.next': 'Nothing else to do - your photographer will be in touch about next steps.',

  'mail.review.subject': 'Could I ask you a small favor, {name}?',
  'mail.review.hope': "I hope you're enjoying the photos! 💛",
  'mail.review.ask': 'If you have a moment, a short review would mean a lot and help me keep photographing events like yours.',
  'mail.review.cta': 'Write a review',

  'mail.ext.subjectApproved': 'Your selection has been extended until {date}',
  'mail.ext.subjectDeclined': 'An update on your extension request',
  'mail.ext.subjectDeclinedAt': 'An update on your extension request at {business}',
  'mail.ext.approved': 'Your photographer extended your selection until <b>{date}</b> 💛',
  'mail.ext.approvedNext': 'You can keep choosing with the same link and access code.',
  'mail.ext.declined': "This time the selection period can't be extended - please finish choosing by the original date. For any questions, just reply to this email.",

  'mail.anniv.subject': 'A year ago we did a photo shoot together 💛',
  'mail.anniv.memory': 'Almost a year ago we did a photo shoot together at <b>{business}</b> - and I still love remembering those moments ✨',
  'mail.anniv.hope': 'I hope you are still enjoying the photos 💛',
  'mail.anniv.invite': "If you'd like to book another shoot - family, kids, or just because - I'd love to! Simply reply to this email.",
  'mail.anniv.cta': 'View the photos',

  'inv.hi': 'Hi {name}! 📸',
  'inv.ready': 'Your photo gallery is ready for you to choose from.',
  'inv.link': 'Link: {url}',
  'inv.codeLabel': '🔑 Access code:',
  'inv.expiry': 'The gallery is open for choosing until {date}.',
  'inv.waiting': "Can't wait to see what you pick! ✨",
  'inv.yourGallery': 'Your gallery',
};
