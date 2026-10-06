import { describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  SUPPORTED_LANGS,
  arrowNavDelta,
  dictionaryKeyDiff,
  formatCurrency,
  formatDateWithHebrew,
  formatGalleryDate,
  interpolate,
  interpolateParts,
  langDir,
  langFromBrowserTag,
  localizeServerError,
  localizedErrorFromBody,
  resolveInitialLang,
  swipeNavDeltaForLang,
  t,
} from './index';
import { fetchGalleryLanguage, fetchGalleryLanguageOrDefault, parseLanguageInput, saveGalleryLanguage } from './galleryLanguage';
import { he } from './he';

describe('מילונים', () => {
  it.each(SUPPORTED_LANGS)('לשפה %s בדיוק אותם מפתחות כמו בעברית', (lang) => {
    expect(dictionaryKeyDiff(lang)).toEqual({ missing: [], extra: [] });
    expect(Object.keys(DICTIONARIES[lang]).sort()).toEqual(Object.keys(he).sort());
  });

  it.each(SUPPORTED_LANGS)('אין ערכים ריקים ב-%s, והפרמטרים זהים לעברית', (lang) => {
    const paramsOf = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const flatten = (m: unknown): string[] =>
      typeof m === 'string' ? [m] : Object.values(m as Record<string, unknown>).flatMap(flatten);
    for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
      const forms = flatten(value);
      expect(forms.every((f) => f.trim().length > 0), `${lang}:${key}`).toBe(true);
      // כל פרמטר שהשפה משתמשת בו קיים גם בעברית (count מותר ביחיד/רבים)
      const heParams = new Set([...flatten(he[key as keyof typeof he]).flatMap(paramsOf), '{count}']);
      for (const p of forms.flatMap(paramsOf)) expect(heParams.has(p), `${lang}:${key} ${p}`).toBe(true);
    }
  });
});

describe('t()', () => {
  it('מחליף פרמטרים, ופרמטר חסר נשאר', () => {
    expect(t('en', 'common.photoN', { n: 7 })).toBe('Photo 7');
    expect(interpolate('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });

  it('לשון פנייה בעברית: נקבה/זכר/ניטרלי', () => {
    expect(t('he', 'err.loadFailed', undefined, 'f')).toBe('שגיאה בטעינת הגלריה. נסי לרענן.');
    expect(t('he', 'err.loadFailed', undefined, 'm')).toBe('שגיאה בטעינת הגלריה. נסה לרענן.');
    expect(t('he', 'err.loadFailed', undefined, null)).toBe('שגיאה בטעינת הגלריה. נסה/י לרענן.');
    // ניטרלי אוטומטי (slashForm) כשאין n
    expect(t('he', 'hdr.connectedAs', { name: 'דנה' }, null)).toBe('מחובר/ת בתור דנה');
  });

  it('לשון פנייה בספרדית/צרפתית', () => {
    expect(t('es', 'welcome.title', { nameSuffix: ', Ana' }, 'f')).toBe('¡Bienvenida, Ana!');
    expect(t('es', 'welcome.title', { nameSuffix: '' }, 'm')).toBe('¡Bienvenido!');
    expect(t('fr', 'hdr.connectedAs', { name: 'Léa' }, null)).toBe('Connecté·e en tant que Léa');
    // מחרוזת רגילה לא מושפעת ממגדר
    expect(t('en', 'welcome.title', { nameSuffix: '' }, 'f')).toBe('Welcome!');
  });

  it('יחיד/רבים לפי count', () => {
    expect(t('en', 'ext.daysOption', { count: 1 })).toBe('1 day');
    expect(t('en', 'ext.daysOption', { count: 3 })).toBe('3 days');
    expect(t('he', 'ext.daysOption', { count: 1 })).toBe('יום אחד');
    expect(t('he', 'ext.daysOption', { count: 2 })).toBe('2 ימים');
  });

  it('interpolateParts משאיר ערכים שאינם מחרוזת', () => {
    const el = { bold: true };
    expect(interpolateParts('A {x} B', { x: el })).toEqual(['A ', el, ' B']);
    expect(interpolateParts('{n}/{m}', { n: 1, m: 2 })).toEqual(['1', '/', '2']);
  });
});

describe('כיוון וניווט', () => {
  it('rtl לעברית ויידיש, ltr לשאר', () => {
    expect(langDir('he')).toBe('rtl');
    expect(langDir('yi')).toBe('rtl');
    expect(['en', 'es', 'fr'].map((l) => langDir(l as 'en'))).toEqual(['ltr', 'ltr', 'ltr']);
  });

  it('חצים הפוכים בין RTL ל-LTR', () => {
    expect(arrowNavDelta('ArrowLeft', 'he')).toBe(1);
    expect(arrowNavDelta('ArrowRight', 'he')).toBe(-1);
    expect(arrowNavDelta('ArrowLeft', 'en')).toBe(-1);
    expect(arrowNavDelta('ArrowRight', 'fr')).toBe(1);
    expect(arrowNavDelta('Enter', 'en')).toBe(0);
  });

  it('החלקה לפי כיוון, ובלי זום/תנועה אנכית', () => {
    expect(swipeNavDeltaForLang(80, 5, false, 'he')).toBe(1);
    expect(swipeNavDeltaForLang(80, 5, false, 'en')).toBe(-1);
    expect(swipeNavDeltaForLang(-80, 5, false, 'en')).toBe(1);
    expect(swipeNavDeltaForLang(80, 5, true, 'en')).toBe(0);
    expect(swipeNavDeltaForLang(60, 90, false, 'en')).toBe(0);
    expect(swipeNavDeltaForLang(20, 0, false, 'en')).toBe(0);
  });
});

describe('פורמט תאריכים ומטבע', () => {
  const date = new Date('2026-10-12T09:00:00Z');

  it('תאריך עברי רק בעברית/יידיש', () => {
    expect(formatGalleryDate('he', date)).toMatch(/תשפ״ז$/);
    expect(formatGalleryDate('yi', date)).toBe(formatGalleryDate('he', date));
    expect(formatGalleryDate('en', date)).toBe('October 12, 2026');
    expect(formatGalleryDate('fr', date)).toBe('12 octobre 2026');
    expect(formatGalleryDate('es', date)).toBe('12 de octubre de 2026');
  });

  it('לועזי + עברי בעברית, לועזי בלבד באנגלית', () => {
    expect(formatDateWithHebrew('he', date)).toMatch(/^12\.10\.2026 · .*תשפ״ז$/);
    expect(formatDateWithHebrew('en', date)).toBe('October 12, 2026');
    expect(formatGalleryDate('en', 'not a date')).toBe('');
  });

  it('שקלים דרך Intl', () => {
    expect(formatCurrency('en', 12)).toBe('₪12');
    expect(formatCurrency('en', 12.5)).toBe('₪12.5');
    expect(formatCurrency('he', 40)).toContain('₪');
    expect(formatCurrency('he', 40)).toContain('40');
  });
});

describe('העדפת שפה', () => {
  it('בחירה שמורה > שפת גלריה > דפדפן > עברית', () => {
    expect(resolveInitialLang({ stored: 'fr', galleryLang: 'en', browserLangs: ['es'] })).toBe('fr');
    expect(resolveInitialLang({ stored: 'xx', galleryLang: 'en', browserLangs: ['es'] })).toBe('en');
    expect(resolveInitialLang({ galleryLang: null, browserLangs: ['de-DE', 'es-MX'] })).toBe('es');
    expect(resolveInitialLang({ browserLangs: ['de'] })).toBe('he');
  });

  it('קודי דפדפן ישנים', () => {
    expect(langFromBrowserTag('iw-IL')).toBe('he');
    expect(langFromBrowserTag('ji')).toBe('yi');
    expect(langFromBrowserTag('en_GB')).toBe('en');
    expect(langFromBrowserTag('')).toBeNull();
  });
});

describe('שגיאות שרת', () => {
  it('הודעה מוכרת מתורגמת, לא מוכרת נשארת', () => {
    expect(localizeServerError('en', 'קוד גישה שגוי')).toBe('Incorrect access code');
    expect(localizeServerError('he', 'קוד גישה שגוי')).toBe('קוד גישה שגוי');
    expect(localizeServerError('en', 'הודעה לא מוכרת')).toBe('הודעה לא מוכרת');
    expect(localizedErrorFromBody('fr', null, 'fallback')).toBe('fallback');
    expect(localizedErrorFromBody('es', { error: 'תוקף הגלריה פג' }, 'x')).toBe('Esta galería ha caducado');
  });
});

describe('הודעת ההזמנה בשפת הגלריה', () => {
  it('אנגלית: טקסט ו-dir=ltr; ברירת מחדל עברית ללא שינוי', async () => {
    const { buildInviteMessageText, buildInviteMessageHtml } = await import('../clientInviteMessage');
    const base = { clientName: 'Dana', galleryUrl: 'https://x/gallery/1', accessCode: 'AB12', expiresAt: '2026-10-12' };
    expect(buildInviteMessageText({ ...base, language: 'en' })).toContain('Hi Dana! 📸');
    expect(buildInviteMessageText({ ...base, language: 'en' })).toContain('open for choosing until October 12, 2026');
    expect(buildInviteMessageHtml({ ...base, language: 'en' })).toContain('dir="ltr"');
    expect(buildInviteMessageHtml({ ...base, language: 'yi' })).toContain('dir="rtl"');
    expect(buildInviteMessageText(base)).toContain('היי Dana! 📸');
  });
});

describe('galleries.language (עמודה חסרה)', () => {
  function fakeSupabase(result: { data?: unknown; error?: unknown }) {
    const chain: any = {
      select: () => chain,
      update: () => chain,
      eq: () => (result.data !== undefined ? chain : Promise.resolve(result)),
      maybeSingle: () => Promise.resolve(result),
    };
    return { from: () => chain };
  }

  it('קריאה: ערך תקין / עמודה חסרה = null / ברירת מחדל עברית', async () => {
    expect(await fetchGalleryLanguage(fakeSupabase({ data: { language: 'yi' }, error: null }), 'g')).toBe('yi');
    const missing = fakeSupabase({ data: null, error: { code: '42703', message: 'column galleries.language does not exist' } });
    expect(await fetchGalleryLanguage(missing, 'g')).toBeNull();
    expect(await fetchGalleryLanguageOrDefault(missing, 'g')).toBe('he');
  });

  it('שמירה: עמודה חסרה לא זורקת', async () => {
    expect(await saveGalleryLanguage(fakeSupabase({ error: { code: 'PGRST204' } }), 'g', 'en')).toBe('missing-column');
    expect(await saveGalleryLanguage(fakeSupabase({ error: null }), 'g', 'en')).toBe('ok');
    expect(await saveGalleryLanguage(fakeSupabase({ error: { code: '500' } }), 'g', 'en')).toBe('error');
  });

  it('אימות קלט', () => {
    expect(parseLanguageInput(undefined)).toEqual({ ok: true, value: null });
    expect(parseLanguageInput('fr')).toEqual({ ok: true, value: 'fr' });
    expect(parseLanguageInput('de').ok).toBe(false);
  });
});
