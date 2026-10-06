import { describe, expect, it } from 'vitest';
import { buildStageMessageHtml, buildStageMessageText, MESSAGE_STAGES } from './clientInviteMessage';
import { SUPPORTED_LANGS } from './i18n/types';
import { dictionaryKeyDiff } from './i18n';

const base = {
  clientName: 'רחל',
  galleryUrl: 'https://example.com/gallery/abc',
  accessCode: 'XY12AB',
  businessName: 'סטודיו דנה',
};

describe('buildStageMessageText', () => {
  it('תזכורת חמה בלשון נקבה (ברירת מחדל) עם קישור וקוד', () => {
    expect(buildStageMessageText({ ...base, stage: 'reminder' })).toBe(
      'היי רחל! 💛\n\nרק תזכורת קטנה - התמונות שלך עדיין מחכות שתבחרי את האהובות עלייך 😊\n\nקישור: https://example.com/gallery/abc\n\n🔑 קוד גישה:\nXY12AB\n\nבאהבה, סטודיו דנה'
    );
  });

  it('לשון זכר ורשמי', () => {
    const msg = buildStageMessageText({ ...base, clientName: 'דוד', clientGender: 'm', stage: 'reminder', tone: 'formal' });
    expect(msg.startsWith('שלום דוד,')).toBe(true);
    expect(msg).toContain('שתשלים');
    expect(msg).toContain('בברכה, סטודיו דנה');
  });

  it('"התחלתי לערוך" בלי קישור ובלי קוד', () => {
    const msg = buildStageMessageText({ ...base, stage: 'editing' });
    expect(msg).toContain('התחלתי לערוך');
    expect(msg).not.toContain('קישור');
    expect(msg).not.toContain('XY12AB');
  });

  it('"התמונות מוכנות" עם כמות, קישור ובלי קוד', () => {
    const msg = buildStageMessageText({ ...base, stage: 'ready', deliveredCount: 48 });
    expect(msg).toContain('48 תמונות');
    expect(msg).toContain('https://example.com/gallery/abc');
    expect(msg).not.toContain('XY12AB');
  });

  it('תוקף רק בשלבים שעוד בוחרים', () => {
    expect(buildStageMessageText({ ...base, stage: 'reopened', expiresAt: '2026-10-20' })).toContain('פתוחה לבחירה עד');
    expect(buildStageMessageText({ ...base, stage: 'ready', expiresAt: '2026-10-20' })).not.toContain('פתוחה לבחירה עד');
  });

  it('בלי שם ובלי שם עסק - בלי רווח מיותר ובלי חתימה', () => {
    const msg = buildStageMessageText({ galleryUrl: base.galleryUrl, accessCode: 'A1', stage: 'editing' });
    expect(msg.startsWith('היי! 💛')).toBe(true);
    expect(msg).not.toContain('באהבה');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('{');
  });

  it('אנגלית', () => {
    const msg = buildStageMessageText({ ...base, clientName: 'Anna', language: 'en', stage: 'ready', deliveredCount: 3 });
    expect(msg.startsWith('Hi Anna! 💛')).toBe(true);
    expect(msg).toContain('3 edited photos');
  });

  it('כל השפות, כל השלבים והטונים - בלי פרמטרים שלא הוחלפו', () => {
    for (const language of SUPPORTED_LANGS) {
      for (const stage of MESSAGE_STAGES) {
        for (const tone of ['warm', 'formal'] as const) {
          const msg = buildStageMessageText({ ...base, language, stage, tone, deliveredCount: 5 });
          expect(msg).not.toMatch(/\{\w+\}/);
        }
      }
      expect(dictionaryKeyDiff(language)).toEqual({ missing: [], extra: [] });
    }
  });
});

describe('buildStageMessageHtml', () => {
  it('כיוון ושפה לפי שפת הגלריה', () => {
    expect(buildStageMessageHtml({ ...base, stage: 'reminder' })).toContain('dir="rtl" lang="he"');
    expect(buildStageMessageHtml({ ...base, language: 'fr', stage: 'reminder' })).toContain('dir="ltr" lang="fr"');
  });

  it('מנטרל HTML בערכים דינמיים', () => {
    const html = buildStageMessageHtml({ ...base, clientName: '<script>', businessName: 'A&B', stage: 'editing' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B');
  });

  it('כפתור "צפייה והורדה" בשלב מוכנות, קוד גישה בתזכורת', () => {
    expect(buildStageMessageHtml({ ...base, stage: 'ready', deliveredCount: 2 })).toContain('צפייה והורדה');
    expect(buildStageMessageHtml({ ...base, stage: 'reminder' })).toContain('XY12AB');
    expect(buildStageMessageHtml({ ...base, stage: 'editing' })).not.toContain('href=');
  });
});
