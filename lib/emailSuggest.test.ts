import { describe, it, expect } from 'vitest';
import { emailSuggestions } from './emailSuggest';

describe('emailSuggestions', () => {
  it('ריק / רווחים - אין הצעות', () => {
    expect(emailSuggestions('')).toEqual([]);
    expect(emailSuggestions('a b')).toEqual([]);
  });

  it('בלי @ - מציעה דומיינים נפוצים', () => {
    expect(emailSuggestions('dina')).toEqual(['dina@gmail.com', 'dina@walla.co.il', 'dina@hotmail.com', 'dina@yahoo.com']);
  });

  it('אחרי @ - דומיינים נפוצים, gmail ראשון', () => {
    expect(emailSuggestions('dina@')[0]).toBe('dina@gmail.com');
  });

  it('השלמת דומיין חלקי', () => {
    expect(emailSuggestions('dina@wa')[0]).toBe('dina@walla.co.il');
    expect(emailSuggestions('dina@hot')[0]).toBe('dina@hotmail.com');
  });

  it('דומיין לא מוכר - מציעה סיומות', () => {
    expect(emailSuggestions('dina@studio')).toEqual(['dina@studio.com', 'dina@studio.co.il', 'dina@studio.net', 'dina@studio.org.il']);
    expect(emailSuggestions('dina@studio.co')).toEqual(['dina@studio.com', 'dina@studio.co.il']);
  });

  it('כתובת מלאה - אין הצעות', () => {
    expect(emailSuggestions('dina@gmail.com')).toEqual([]);
    expect(emailSuggestions('dina@studio.co.il')).toEqual([]);
  });

  it('שומרת על שם המשתמש כפי שהוקלד', () => {
    expect(emailSuggestions('Dina.S@GM')[0]).toBe('Dina.S@gmail.com');
  });

  it('בלי שם משתמש או עם שני @ - אין הצעות', () => {
    expect(emailSuggestions('@gm')).toEqual([]);
    expect(emailSuggestions('a@b@c')).toEqual([]);
  });
});
