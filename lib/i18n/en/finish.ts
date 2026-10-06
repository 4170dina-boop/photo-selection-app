// English: bottom bar, finish dialog, extra-price toast, extension banner, collage.
import type { Section } from '../types';
import type { finish as he } from '../he/finish';

export const finish: Section<typeof he> = {
  'bar.countdown': 'Sending your selection in {n} seconds...',
  'bar.undo': 'Undo send',
  'bar.notSent': "Your selection hasn't been sent yet.",
  'bar.sending': 'Sending...',
  'bar.retry': 'Try sending again',
  'bar.selected': 'selected',
  'bar.extra': ' · +{n} extra',
  'bar.needOne': 'Choose at least one photo first',
  'bar.finish': "I'm done ✓",

  'fm.title': 'Before we send it to your photographer ✨',
  'fm.selected': 'Selected',
  'fm.included': 'Included in package',
  'fm.extra': 'Extra photos',
  'fm.gifts': '🎁 Gift photos (included, no charge)',
  'fm.agreedTotal': 'Total to pay',
  'fm.remaining': 'You still have {n} photos left at no extra cost',
  'fm.undecided': {
    one: '🤔 1 "maybe" photo still undecided',
    other: '🤔 {count} "maybe" photos still undecided',
  },
  'fm.review': 'Review them',
  'fm.pending': "{n} changes haven't been saved yet - they'll be sent first.",
  'fm.noUndo': "After sending, the selection can't be changed (you'll have {n} seconds to undo).",
  'fm.send': 'Send to photographer ✓',
  'fm.backToChoosing': 'Back to choosing',
  'toast.extraPrice': "✨ You've passed the {included} photos in your package · Each extra photo: {price}",

  'ext.lastDay': '⏳ Today is the last day to choose',
  'ext.daysLeft': { one: '⏳ 1 day left to choose', other: '⏳ {count} days left to choose' },
  'ext.until': 'You can choose until {date}',
  'ext.request': 'Ask for more time',
  'ext.howMany': 'How many extra days?',
  'ext.daysOption': { one: '1 day', other: '{count} days' },
  'ext.sent': {
    one: 'Your request for 1 more day was sent to your photographer 💛',
    other: 'Your request for {count} more days was sent to your photographer 💛',
  },
  'ext.pending': {
    one: "You asked for 1 more day - your photographer will get back to you soon",
    other: "You asked for {count} more days - your photographer will get back to you soon",
  },
  'ext.limit': "You've already asked for more time twice - for questions, please contact your photographer",
  'ext.declined': "The previous extension request wasn't approved.",
  'ext.sendFailed': "Couldn't send the request - please try again",
  'ext.sendFailedNet': "Couldn't send the request - please check your connection and try again",

  'col.title': '🎁 A gift collage from your picks',
  'col.sub': "We've arranged some of the photos you chose - a little keepsake",
  'col.rendering': 'Creating your collage...',
  'col.unavailable': "We couldn't create the collage right now - please try again later.",
  'col.alt': 'Collage of the photos you chose',
  'col.download': '⬇️ Download the collage',
  'col.share': '📱 Save to phone',
  'col.shareFailed': "Saving didn't work - you can use the download button instead",
  'col.canvasTitle': 'My picks ✨',
  'col.fileName': 'my-collage',
};
