// ייִדיש: ברוכים הבאים, קעפל, אן אינטערנעט, פעקעדזש אינפארמאציע.
import type { Section } from '../types';
import type { welcome as he } from '../he/welcome';

export const welcome: Section<typeof he> = {
  'welcome.title': 'ברוכים הבאים{nameSuffix}!',
  'welcome.ready': 'די גאלעריע איז גרייט צום אויסקלייבן',
  'welcome.package': ' - אייער פעקעדזש נעמט אריין {n} בילדער',
  'welcome.until': ', ביז {date}',
  'welcome.end': '.',
  'welcome.tipOpen': '🔍 דריקט אויף א בילד כדי עס צו זען גרויס, און קלייבט אויס מיט די קנעפלעך אונטן',
  'welcome.tipCompare': '⇄ מען קען פארגלייכן עטליכע בילדער איינס לעבן צווייטן',
  'welcome.tipNote': '✎ מען קען לאזן א פערזענליכע באמערקונג פארן פאטאגראף אויף יעדן בילד (פון דער גרויסער ווייזונג)',
  'welcome.gifts': {
    one: '🎁 אין דער גאלעריע ווארט אויך א מתנה-בילד פון מיר - עס ווערט נישט גערעכנט אינעם פעקעדזש',
    other: '🎁 אין דער גאלעריע ווארטן אויך {count} מתנה-בילדער פון מיר - זיי ווערן נישט גערעכנט אינעם פעקעדזש',
  },
  'welcome.guestNote': '👀 אייערע אויסוואלן דא זענען נאר פארשלאגן - נאר {owner} קען ענדיגן די אויסוואל',
  'welcome.start': 'לאמיר אנהייבן ✨',

  'hdr.connectedAs': 'אריין אלס {name}',
  'hdr.family': ' (משפחה)',
  'hdr.compare': '⇄ פארגלייכן',
  'hdr.exitCompare': '✕ ארויס פון פארגלייכן',
  'hdr.swipe': '⚡ שנעלע אויסוואל',
  'hdr.exitSwipe': '✕ ארויס פון שנעלע אויסוואל',
  'hdr.more': '⋯ נאך',
  'hdr.moreAria': 'נאך אקציעס',
  'hdr.selectedInPackage': 'אויסגעקליבן אינעם פעקעדזש',
  'hdr.viewed': 'איר האט דורכגעקוקט {seen} פון {total} בילדער',
  'hdr.viewedAria': 'בילדער וואס איר האט דורכגעקוקט',

  'off.noInternet': '📴 קיין אינטערנעט - ',
  'off.pending': {
    one: 'איין ענדערונג ווארט און וועט אויטאמאטיש געשיקט ווערן ווען די פארבינדונג קומט צוריק.',
    other: '{count} ענדערונגען ווארטן און וועלן אויטאמאטיש געשיקט ווערן ווען די פארבינדונג קומט צוריק.',
  },
  'off.keepGoing': 'מען קען ווייטער קוקן און אויסקלייבן - די אויסוואלן וועלן געשיקט ווערן ווען די פארבינדונג קומט צוריק.',

  'info.packageIncludes': 'דער פעקעדזש נעמט אריין {n} בילדער',
  'info.remaining': ' · עס בלייבן נאך {n} אינעם פעקעדזש',
  'info.extraPrice': '✨ יעדעס עקסטערע בילד: {price}',
  'info.estimate': 'אומגעפערער סך הכל: {total}',
  'info.estimateBreakdown': ' ({base} פעקעדזש + {extra} עקסטרא)',
  'info.agreedTotal': 'סך הכל צו באצאָלן: {total}',
  'info.until': 'מען קען אויסקלייבן ביז {date}',
};
