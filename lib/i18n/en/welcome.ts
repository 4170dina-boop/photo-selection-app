// English: welcome gate, header counters, offline banner, package info box.
import type { Section } from '../types';
import type { welcome as he } from '../he/welcome';

export const welcome: Section<typeof he> = {
  'welcome.title': 'Welcome{nameSuffix}!',
  'welcome.ready': 'Your gallery is ready',
  'welcome.package': ' - your package includes {n} photos',
  'welcome.until': ', open until {date}',
  'welcome.end': '.',
  'welcome.gifts': {
    one: "🎁 There's also a gift photo from me waiting for you - it doesn't count toward your package",
    other: "🎁 There are also {count} gift photos from me waiting for you - they don't count toward your package",
  },
  'welcome.start': "Let's start ✨",

  'hdr.connectedAs': 'Signed in as {name}',
  'hdr.family': ' (family)',
  'hdr.compare': '⇄ Compare',
  'hdr.exitCompare': '✕ Exit compare',
  'hdr.swipe': '⚡ Quick pick',
  'hdr.exitSwipe': '✕ Exit quick pick',
  'hdr.more': '⋯ More',
  'hdr.moreAria': 'More actions',
  'hdr.selectedInPackage': 'Selected in package',
  'hdr.viewed': "You've looked at {seen} of {total} photos",
  'hdr.viewedAria': "Photos you've looked at",

  'off.noInternet': '📴 No internet connection - ',
  'off.pending': {
    one: "1 change is waiting and will be sent automatically once you're back online.",
    other: "{count} changes are waiting and will be sent automatically once you're back online.",
  },
  'off.keepGoing': "You can keep browsing and choosing - your picks will be sent once you're back online.",

  'info.packageIncludes': 'Your package includes {n} photos',
  'info.remaining': ' · {n} more left in your package',
  'info.extraPrice': '✨ Each extra photo: {price}',
  'info.estimate': 'Estimated total: {total}',
  'info.estimateBreakdown': ' ({base} package + {extra} extras)',
  'info.agreedTotal': 'Total to pay: {total}',
  'info.until': 'You can choose until {date}',
};
