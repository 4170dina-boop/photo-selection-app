import { describe, expect, it } from 'vitest';
import {
  expiryDateFromDays,
  expiryDaysFromDate,
  isMissingTemplatesTableError,
  normalizeTemplateData,
  parseTemplateData,
  parseTemplateName,
  templateSummary,
} from './galleryTemplates';

const valid = { includedPhotos: 30, basePrice: 2500, extraPhotoPrice: 50, expiryDays: 14, clientGender: 'm', language: 'en' };

describe('parseTemplateName', () => {
  it('מקצר רווחים ודוחה ריק/ארוך', () => {
    expect(parseTemplateName('  חתונה   מלאה ')).toEqual({ ok: true, value: 'חתונה מלאה' });
    expect(parseTemplateName('').ok).toBe(false);
    expect(parseTemplateName(5).ok).toBe(false);
    expect(parseTemplateName('א'.repeat(61)).ok).toBe(false);
  });
});

describe('parseTemplateData', () => {
  it('תקין', () => {
    expect(parseTemplateData(valid)).toEqual({ ok: true, value: valid });
  });

  it('ברירות מחדל: מחירים 0, בלי תוקף, נקבה, עברית; מחרוזות מספריות', () => {
    expect(parseTemplateData({ includedPhotos: '20' })).toEqual({
      ok: true,
      value: { includedPhotos: 20, basePrice: 0, extraPhotoPrice: 0, expiryDays: null, clientGender: 'f', language: 'he' },
    });
  });

  it('מסנן שדות לא מוכרים', () => {
    const r = parseTemplateData({ ...valid, evil: '<script>' });
    expect(r.ok && Object.keys(r.value)).toEqual(['includedPhotos', 'basePrice', 'extraPhotoPrice', 'expiryDays', 'clientGender', 'language']);
  });

  it('דוחה ערכים לא תקינים', () => {
    expect(parseTemplateData(null).ok).toBe(false);
    expect(parseTemplateData([]).ok).toBe(false);
    expect(parseTemplateData({ ...valid, includedPhotos: -1 }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, includedPhotos: 1.5 }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, basePrice: 'abc' }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, expiryDays: 0 }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, expiryDays: 400 }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, clientGender: 'x' }).ok).toBe(false);
    expect(parseTemplateData({ ...valid, language: 'de' }).ok).toBe(false);
  });
});

describe('normalizeTemplateData', () => {
  it('סלחנית לשורות פגומות', () => {
    expect(normalizeTemplateData({ includedPhotos: 10, language: 'de', expiryDays: -3 })).toEqual({
      includedPhotos: 10, basePrice: 0, extraPhotoPrice: 0, expiryDays: null, clientGender: 'f', language: 'he',
    });
    expect(normalizeTemplateData({})).toBeNull();
    expect(normalizeTemplateData('x')).toBeNull();
  });
});

describe('expiry days <-> date', () => {
  const now = new Date(2026, 9, 6, 15, 0);
  it('ימים -> תאריך', () => {
    expect(expiryDateFromDays(14, now)).toBe('2026-10-20');
    expect(expiryDateFromDays(30, now)).toBe('2026-11-05');
    expect(expiryDateFromDays(null, now)).toBe('');
  });
  it('תאריך -> ימים', () => {
    expect(expiryDaysFromDate('2026-10-20', now)).toBe(14);
    expect(expiryDaysFromDate('', now)).toBeNull();
    expect(expiryDaysFromDate('2026-10-06', now)).toBeNull();
    expect(expiryDaysFromDate('2026-10-01', now)).toBeNull();
  });
});

describe('isMissingTemplatesTableError', () => {
  it('מזהה טבלה חסרה', () => {
    expect(isMissingTemplatesTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTemplatesTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTemplatesTableError({ message: 'relation "gallery_templates" does not exist' })).toBe(true);
    expect(isMissingTemplatesTableError({ code: '23505' })).toBe(false);
    expect(isMissingTemplatesTableError(null)).toBe(false);
  });
});

describe('templateSummary', () => {
  it('תיאור קצר', () => {
    expect(templateSummary({ ...valid, clientGender: 'f', language: 'he' })).toBe('30 תמונות · ₪2,500 · ₪50 לנוספת · 14 ימים');
  });
});
