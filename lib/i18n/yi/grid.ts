// ייִדיש: פילטערס, "צוזאמען אויסקלייבן" מעלדונג, בילדער-קארטלעך.
import type { Section } from '../types';
import type { grid as he } from '../he/grid';

export const grid: Section<typeof he> = {
  'f.all': 'אלע ({n})',
  'f.selected': 'אויסגעקליבן ({n})',
  'f.maybe': 'אפשר ({n})',
  'f.picks': '⭐ רעקאמענדירט ({n})',
  'card.pickBadge': '⭐ רעקאמענדירט',
  'card.pickTitle': 'דער פאטאגראף רעקאמענדירט דאס בילד',
  'f.together': '💞 אלע האבן אויסגעקליבן ({n})',
  'f.only': 'נאר {name} ({n})',
  'f.onlyMe': 'נאר איך ({n})',
  'grid.empty': 'קיין בילדער פאסן נישט צו דעם פילטער.',
  'grid.colsAria': 'צאל קאלאנעס: {n} (דריקט צו טוישן)',

  'toast.othersItem': {
    one: '{name} האט אנגעצייכנט א נייע בילד',
    other: '{name} האט אנגעצייכנט {count} נייע בילדער',
  },

  'card.compareOn': 'אויסגעקליבן צום פארגלייכן',
  'card.compareOff': 'נישט אויסגעקליבן צום פארגלייכן',
  'card.open': 'עפענען {label}',
  'card.hasNote': ', האט א באמערקונג',
  'card.badgeMaybe': '🤔 אפשר',
  'card.blurAria': 'דאס בילד איז אפשר נישט שארף (אויטאמאטישע אפשאצונג)',
  'card.blurTitle': 'אויטאמאטישע אפשאצונג לויט שארפקייט - נישט שטענדיג גענוי',
  'card.blurLabel': '💡 אפשר נישט שארף',
  'card.markSelected': 'אויסגעקליבן',
  'card.markMaybe': 'אפשר',
  'card.giftTitle': 'מתנה-בילד - אויטאמאטיש אריינגערעכנט, ווערט נישט גערעכנט אינעם פעקעדזש און אן עקסטערע צאלונג',
  'card.giftFooter': 'אויטאמאטיש אריינגערעכנט · ווערט נישט גערעכנט אינעם פעקעדזש',
  'card.heartAria': 'אויסקלייבן {label}',
  'card.heartOn': 'אויסמעקן די אויסוואל',
  'card.heartOff': 'אויסקלייבן דאס בילד',
  'card.noteTitle': 'דאס בילד האט א באמערקונג',
};
