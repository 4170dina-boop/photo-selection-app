// English: filters, "choosing together" toast, grid cards.
import type { Section } from '../types';
import type { grid as he } from '../he/grid';

export const grid: Section<typeof he> = {
  'f.all': 'All ({n})',
  'f.selected': 'Selected ({n})',
  'f.maybe': 'Maybe ({n})',
  'f.picks': '⭐ Photographer picks ({n})',
  'card.pickBadge': '⭐ Photographer pick',
  'card.pickTitle': 'Specially recommended by your photographer',
  'f.together': '💞 Everyone chose ({n})',
  'f.only': 'Only {name} ({n})',
  'f.onlyMe': 'Only me ({n})',
  'grid.empty': 'No photos match this filter.',
  'grid.colsAria': 'Grid columns: {n} (tap to change)',

  'toast.othersItem': {
    one: '{name} marked a new photo',
    other: '{name} marked {count} new photos',
  },

  'card.compareOn': 'selected for comparison',
  'card.compareOff': 'not selected for comparison',
  'card.open': 'Open {label}',
  'card.hasNote': ', has a note',
  'card.badgeMaybe': '🤔 Maybe',
  'card.blurAria': 'This photo may not be sharp (automatic estimate)',
  'card.blurTitle': 'Automatic sharpness estimate - not always accurate',
  'card.blurLabel': '💡 May not be sharp',
  'card.markSelected': 'selected',
  'card.markMaybe': 'maybe',
  'card.giftTitle': "Gift photo - included automatically, doesn't count toward your package, no extra charge",
  'card.giftFooter': "Included automatically · doesn't count toward your package",
  'card.heartAria': 'Select {label}',
  'card.heartOn': 'Unselect',
  'card.heartOff': 'Select this photo',
  'card.noteTitle': 'This photo has a note',
};
