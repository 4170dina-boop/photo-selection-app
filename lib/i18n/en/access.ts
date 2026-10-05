// English: access-code screen and identify/join screen.
import type { Section } from '../types';
import type { access as he } from '../he/access';

export const access: Section<typeof he> = {
  'code.title': '✨ Enter the access code you received',
  'code.enterCode': 'Please enter your access code',
  'code.pasteAria': 'Paste the access code from the clipboard',
  'code.paste': '📋 Paste',
  'code.checking': 'Checking...',
  'code.enter': 'Open gallery',
  'code.pasteNoCode': 'No code found in what you copied - you can type it in instead',
  'code.pasteFailed': "Couldn't read the clipboard - long-press the box to paste",
  'code.authFailed': 'Something went wrong - please try again',
  'code.tooMany': 'Too many attempts - please try again in a few minutes',
  'code.unavailable': 'The service is unavailable right now - please try again shortly',
  'code.wrong': 'Incorrect access code',

  'id.hi': '👋 Hi!',
  'id.hiName': '👋 Hi, {name}!',
  'id.ownerEmailLabel': "Just to confirm - what's your email address? (the one your photographer sent the invite to)",
  'id.confirmEnter': 'Confirm and continue',
  'id.whoIsIn': "Who's viewing the gallery?",
  'id.itsMe': "Yes, it's me",
  'id.notMe': "No, I'm family or a friend",
  'id.nameLabel': "What's your name?",
  'id.namePlaceholder': 'e.g. Grandma Ruth / Josh (husband)',
  'id.genderLabel': 'How should we address you?',
  'id.genderF': '👩 Feminine form',
  'id.genderM': '👨 Masculine form',
  'id.joining': 'Joining...',
  'id.join': 'Join the gallery',
};
