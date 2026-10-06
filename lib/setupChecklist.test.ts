import { describe, it, expect } from 'vitest';
import { evaluateSetupChecklist, isSandboxFromAddress, summarizeChecklist, type SetupChecklistInput } from './setupChecklist';

const empty: SetupChecklistInput = {
  photographer: {
    logo_url: null,
    watermark_text: null,
    default_base_price: 0,
    default_extra_photo_price: 0,
    payment_bit_url: null,
    payment_paybox_url: null,
    payment_bank_details: null,
    payment_links_available: true,
  },
  realGalleryCount: 0,
  capabilities: { ai: false, email: true, emailSandbox: true },
};

function byId(input: SetupChecklistInput) {
  return Object.fromEntries(evaluateSetupChecklist(input).map((i) => [i.id, i]));
}

describe('isSandboxFromAddress', () => {
  it('מזהה את כתובת ה-sandbox גם עם שם תצוגה', () => {
    expect(isSandboxFromAddress('onboarding@resend.dev')).toBe(true);
    expect(isSandboxFromAddress('"סטודיו" <Onboarding@Resend.dev>')).toBe(true);
    expect(isSandboxFromAddress('studio@dina.co.il')).toBe(false);
    expect(isSandboxFromAddress(null)).toBe(false);
  });
});

describe('evaluateSetupChecklist', () => {
  it('בלי צלמת -> ריק', () => {
    expect(evaluateSetupChecklist({ ...empty, photographer: null })).toEqual([]);
  });

  it('צלמת חדשה - כלום לא מסומן', () => {
    const items = byId(empty);
    expect(items.logo.done).toBe(false);
    expect(items.watermark.done).toBe(false);
    expect(items.package.done).toBe(false);
    expect(items.firstGallery.done).toBe(false);
    expect(items.payment.done).toBe(false);
    expect(items.emailDomain.done).toBe(false);
    expect(items.ai.done).toBe(false);
  });

  it('לוגו מסמן גם סימן מים', () => {
    const items = byId({ ...empty, photographer: { ...empty.photographer, logo_url: 'https://x/logo.png' } });
    expect(items.logo.done).toBe(true);
    expect(items.watermark.done).toBe(true);
  });

  it('טקסט סימן מים בלבד', () => {
    const items = byId({ ...empty, photographer: { ...empty.photographer, watermark_text: 'דינה' } });
    expect(items.logo.done).toBe(false);
    expect(items.watermark.done).toBe(true);
  });

  it('חבילה - מחיר כמחרוזת (numeric מ-PostgREST)', () => {
    const items = byId({ ...empty, photographer: { ...empty.photographer, default_base_price: '1200.00' } });
    expect(items.package.done).toBe(true);
  });

  it('אמצעי תשלום כלשהו, כולל שדה עתידי', () => {
    expect(byId({ ...empty, photographer: { ...empty.photographer, payment_bank_details: 'בנק 12' } }).payment.done).toBe(true);
    expect(byId({ ...empty, photographer: { ...empty.photographer, payment_future_url: 'https://pay' } }).payment.done).toBe(true);
  });

  it('אין עמודות תשלום -> אין סעיף', () => {
    const items = byId({ ...empty, photographer: { ...empty.photographer, payment_links_available: false } });
    expect(items.payment).toBeUndefined();
  });

  it('גלריה ראשונה', () => {
    expect(byId({ ...empty, realGalleryCount: 2 }).firstGallery.done).toBe(true);
    expect(byId({ ...empty, realGalleryCount: null }).firstGallery.done).toBe(false);
  });

  it('דומיין: לא ידוע / אין מייל -> בלי סעיף', () => {
    expect(byId({ ...empty, capabilities: { ai: true, email: true, emailSandbox: null } }).emailDomain).toBeUndefined();
    expect(byId({ ...empty, capabilities: { ai: true, email: false, emailSandbox: true } }).emailDomain).toBeUndefined();
    expect(byId({ ...empty, capabilities: { ai: true, email: true, emailSandbox: false } }).emailDomain.done).toBe(true);
  });

  it('בלי capabilities -> בלי סעיפי מידע', () => {
    const items = byId({ ...empty, capabilities: null });
    expect(items.ai).toBeUndefined();
    expect(items.emailDomain).toBeUndefined();
  });
});

describe('summarizeChecklist', () => {
  it('הכול גמור -> allDone גם כשיש אזהרות מידע', () => {
    const items = evaluateSetupChecklist({
      photographer: {
        logo_url: 'https://x/l.png',
        default_base_price: 100,
        payment_bit_url: 'https://bit',
        payment_links_available: true,
      },
      realGalleryCount: 1,
      capabilities: { ai: false, email: true, emailSandbox: true },
    });
    const s = summarizeChecklist(items);
    expect(s.allDone).toBe(true);
    expect(s.doneCount).toBe(5);
    expect(s.totalTasks).toBe(5);
    expect(s.warnings.map((w) => w.id).sort()).toEqual(['ai', 'emailDomain']);
  });

  it('חלקי', () => {
    const s = summarizeChecklist(evaluateSetupChecklist(empty));
    expect(s.allDone).toBe(false);
    expect(s.doneCount).toBe(0);
  });

  it('רשימה ריקה לא נחשבת גמורה', () => {
    expect(summarizeChecklist([]).allDone).toBe(false);
  });
});
