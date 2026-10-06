// English: large view, slideshow, note dialog.
import type { Section } from '../types';
import type { enlarged as he } from '../he/enlarged';

export const enlarged: Section<typeof he> = {
  'en.aria': 'Large view: photo {n}',
  'en.kbd': 'Arrow keys to browse photos, Escape to close',
  'en.kbdMark': '. S - I want this one, M - maybe',
  'en.zoomTitle': 'Click or use the mouse wheel to zoom',
  'en.counter': 'Photo {current} / {total}',
  'en.selected': 'Selected',
  'en.extra': '+{n} extra',
  'en.extraCost': ' (extra {cost})',
  'en.guestMine': 'Your picks (suggestions only): {n}',
  'en.othersPicked': {
    one: '💞 {names} also chose this photo',
    other: '💞 {names} also chose this photo',
  },
  'en.noteEditAria': 'Edit your note to the photographer about this photo',
  'en.noteAddAria': 'Add a note to the photographer about this photo',
  'en.noteEdit': '✎ Edit note to photographer',
  'en.noteAdd': '✎ Note to photographer',
  'en.wantTitle': 'I want this one (S key)',
  'en.want': '✓ I want this one',
  'en.wantOn': 'Selected · tap again to undo',
  'en.maybeTitle': 'Maybe (M key)',
  'en.maybe': '🤔 Maybe',
  'en.maybeOn': 'Marked',
  'en.giftFromMe': '🎁 A gift from me',
  'en.giftIncluded': ' - included automatically, no need to select it',

  'ss.aria': 'Slideshow: photo {i} of {total}',
  'ss.exitTitle': 'Exit slideshow',
  'ss.exit': '✕ Exit',
  'ss.maybeOn': '✓ Maybe',
  'ss.maybeOff': '? Maybe',
  'ss.selectedOn': '✓ Selected',
  'ss.select': '✓ Select',
  'ss.giftIncluded': '🎁 A gift from me - included automatically',

  'note.title': 'Note on this photo',
  'note.reply': 'Reply from {name}:',
  'note.placeholder': 'e.g. I’d love this one in black and white',
};
