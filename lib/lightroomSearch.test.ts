import { describe, expect, it } from 'vitest';
import { buildLightroomSearchString, fileBaseName, lightroomCopiedToast, lightroomSearchNames, stripExtension } from './lightroomSearch';

describe('stripExtension / fileBaseName', () => {
  it('מסירה סיומת אחרונה בלבד', () => {
    expect(stripExtension('IMG_1234.CR3')).toBe('IMG_1234');
    expect(stripExtension('a.b.jpeg')).toBe('a.b');
    expect(stripExtension('no-ext')).toBe('no-ext');
    expect(stripExtension('.hidden')).toBe('.hidden');
    expect(stripExtension('חתונה.דנה')).toBe('חתונה.דנה');
  });

  it('מסירה נתיב', () => {
    expect(fileBaseName('folder/sub/DSC_1.jpg')).toBe('DSC_1.jpg');
    expect(fileBaseName('C:\\x\\DSC_2.jpg')).toBe('DSC_2.jpg');
  });
});

describe('buildLightroomSearchString', () => {
  it('מפריד ב-", " בלי סיומות', () => {
    expect(buildLightroomSearchString(['IMG_1.jpg', 'IMG_2.CR3', 'DSC_9.jpeg'])).toBe('IMG_1, IMG_2, DSC_9');
  });

  it('עם סיומת', () => {
    expect(buildLightroomSearchString(['IMG_1.jpg', 'IMG_2.CR3'], { withExtension: true })).toBe('IMG_1.jpg, IMG_2.CR3');
  });

  it('מסירה כפילויות (בלי רישיות) וריקים, שומרת סדר', () => {
    expect(lightroomSearchNames(['b.jpg', 'A.jpg', 'B.JPG', '', '  ', 'a.png'])).toEqual(['b', 'A']);
    // עם סיומת - אותו שם בסיומת שונה הוא קובץ אחר
    expect(lightroomSearchNames(['a.jpg', 'a.png'], { withExtension: true })).toEqual(['a.jpg', 'a.png']);
  });

  it('רשימה ריקה = מחרוזת ריקה', () => {
    expect(buildLightroomSearchString([])).toBe('');
  });
});

describe('lightroomCopiedToast', () => {
  it('יחיד/רבים', () => {
    expect(lightroomCopiedToast(48)).toBe('הועתקו 48 שמות ✓');
    expect(lightroomCopiedToast(1)).toBe('הועתק שם אחד ✓');
  });
});
