// English: grid banners, thank-you screen, final photos, watermark note.
import type { Section } from '../types';
import type { banners as he } from '../he/banners';

export const banners: Section<typeof he> = {
  'over.banner': '✨ You chose {selected} photos ({included} included + {extra} extra) · Extra: {cost}',
  'gift.banner': {
    one: "🎁 I made you a gift photo - it's already included, with no effect on your package and no extra charge. No need to select it.",
    other: "🎁 I made you {count} gift photos - they're already included, with no effect on your package and no extra charge. No need to select them.",
  },
  'hint.tap': '✨ New: tap a photo to see it large, then choose with the buttons below',
  'resume.text': '👋 Welcome back! Continue from photo {n}?',
  'resume.continue': 'Continue',
  'grid.hint': 'Tap a photo to see it large · {heart} in the corner picks it fast',
  'ro.ended': 'The selection period for this gallery has ended - you can still view the photos and download any delivered ones.',
  'ro.endedWithDate': 'The selection period for this gallery ended ({date}) - you can still view the photos and download any delivered ones.',
  'ro.viewOnlyEnded': 'The selection period has ended - view only.',
  'ro.viewOnlySent': 'Your selection has been sent - view only.',

  'thanks.title': 'Thank you{nameSuffix}!',
  'thanks.body': "Your selection has been received ✨ Nothing else to do - your photographer can already see your picks and will be in touch about next steps.",
  'thanks.bodyNamed': "Your selection has reached {photographer} ✨ Nothing else to do - {photographer} can already see your picks and will be in touch about next steps.",
  'thanks.viewOnly': "✓ You can still view the photos below, but the selection can't be changed.",
  'cele.done': '🎉 All done! Your photographer is being notified',

  'dl.title': '💛 Your final photos are ready!',
  'dl.sub': {
    one: '1 edited photo - view and download it.',
    other: '{count} edited photos - view and download them one by one or all at once.',
  },
  'dl.preparingZip': 'Preparing ZIP...',
  'dl.zipAll': '📦 Download all as ZIP',
  'dl.zipFileName': 'final-photos.zip',
  'dl.zipSummary': 'Downloaded {done} of {total} photos',
  'dl.zipPartial': 'Downloaded {done} of {total} photos - try again to get the rest',
  'dl.downloadAria': 'Download {name}',
  'dl.downloadTitle': 'Download photo',
  'dl.downloading': 'Downloading...',
  'dl.download': '⬇ Download',

  'wm.note': "🔒 Photos here are shown with a watermark. You'll receive the clean, edited photos at the end 💛",
};
