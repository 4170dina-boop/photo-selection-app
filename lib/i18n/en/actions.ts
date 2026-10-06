// English: action buttons, compare view, quick pick.
import type { Section } from '../types';
import type { actions as he } from '../he/actions';

export const actions: Section<typeof he> = {
  'act.exitCompare': 'Exit compare',
  'act.compareHint': 'Choose up to {max} photos to compare ({count}/{max})',
  'act.compareNow': 'Compare now ({count})',
  'act.slideshow': '▶ Slideshow',
  'act.clearing': 'Clearing...',
  'act.clearAll': '🗑 Clear all my picks',
  'act.clearConfirm': "Clear all your picks in this gallery? This can't be undone.",
  'act.aiTitle': "Claude looks at up to 60 photos and marks the strongest as 'maybe' - a starting point, not a final choice",
  'act.aiRunning': 'Analyzing photos...',
  'act.aiHelp': '🪄 Help me choose',
  'act.aiPicked': 'I marked {picked} of {analyzed} analyzed photos as "maybe" - you can still change everything',
  'act.aiNone': "I couldn't find clear standouts to mark - you may have already marked them all",
  'act.onlyOwnerFinal': 'Only {owner} can submit the final selection - your picks here are suggestions to discuss.',

  'cmp.aria': 'Compare photos',
  'cmp.exit': 'Exit compare',
  'cmp.pick': 'Choose this one ✓',

  'sw.summaryAria': 'Quick pick summary',
  'sw.doneSecond': "You've finished the second round too!",
  'sw.doneAll': "You've gone through all the photos!",
  'sw.maybePrompt': 'You marked {n} photos as "maybe" - want to go through them again and decide?',
  'sw.secondPass': 'Yes, second round on "maybe" ({n})',
  'sw.noThanks': "No thanks, I'm done",
  'sw.aria': 'Quick pick: photo {i} of {total}',
  'sw.labelSecond': 'Second round · "maybe" · ',
  'sw.label': 'Quick pick · ',
  'sw.closeAria': 'Close quick pick',
  'sw.skipAria': 'Skip - keep the current mark',
  'sw.skip': 'Skip',
  'sw.maybeAria': 'Mark as maybe',
  'sw.maybe': 'Maybe',
  'sw.pickAria': 'Choose this photo',
  'sw.picked': 'Yes!',

  'status.selected': '✓ Selected',
  'status.maybeMarked': '🤔 Marked maybe',
  'status.unmarked': 'Not marked',
  'status.selectedPlain': 'Selected',
  'status.maybePlain': 'Marked maybe',
  'status.giftPlain': 'Gift photo - included automatically',
};
