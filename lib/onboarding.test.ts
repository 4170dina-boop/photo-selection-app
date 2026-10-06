import { describe, it, expect } from 'vitest';
import { clampWelcomeStep, isOnboardingExemptPath, parseBusinessName, shouldRedirectToWelcome, type OnboardingRedirectInput } from './onboarding';

const base: OnboardingRedirectInput = {
  pathname: '/dashboard/today',
  onboardingDone: false,
  localDone: false,
  galleryCount: 0,
  alreadyRedirectedThisSession: false,
};

describe('shouldRedirectToWelcome', () => {
  it('צלמת חדשה בלי גלריות -> מפנים', () => {
    expect(shouldRedirectToWelcome(base)).toBe(true);
  });
  it('עמודה חסרה (null) בלי דגל מקומי -> מפנים', () => {
    expect(shouldRedirectToWelcome({ ...base, onboardingDone: null })).toBe(true);
  });
  it('סומן כגמור ב-DB -> לא', () => {
    expect(shouldRedirectToWelcome({ ...base, onboardingDone: true })).toBe(false);
  });
  it('דגל מקומי -> לא', () => {
    expect(shouldRedirectToWelcome({ ...base, onboardingDone: null, localDone: true })).toBe(false);
  });
  it('יש גלריה -> לא', () => {
    expect(shouldRedirectToWelcome({ ...base, galleryCount: 1 })).toBe(false);
  });
  it('ספירה לא ידועה -> לא', () => {
    expect(shouldRedirectToWelcome({ ...base, galleryCount: null })).toBe(false);
  });
  it('כבר הופנתה ב-session -> לא (מניעת לולאה)', () => {
    expect(shouldRedirectToWelcome({ ...base, alreadyRedirectedThisSession: true })).toBe(false);
  });
  it('לעולם לא מהאשף/הגדרות/ניהול', () => {
    for (const pathname of ['/dashboard/welcome', '/dashboard/settings', '/dashboard/admin', '/dashboard/admin/x']) {
      expect(shouldRedirectToWelcome({ ...base, pathname })).toBe(false);
    }
  });
  it('דפי דשבורד רגילים כן', () => {
    expect(shouldRedirectToWelcome({ ...base, pathname: '/dashboard/galleries' })).toBe(true);
    expect(shouldRedirectToWelcome({ ...base, pathname: '/dashboard/settingsx' })).toBe(true);
  });
});

describe('isOnboardingExemptPath', () => {
  it('נתיב חסר = פטור', () => {
    expect(isOnboardingExemptPath(null)).toBe(true);
  });
});

describe('parseBusinessName', () => {
  it('מנקה רווחים', () => {
    expect(parseBusinessName('  סטודיו   דינה ')).toEqual({ ok: true, value: 'סטודיו דינה' });
  });
  it('ריק / לא מחרוזת', () => {
    expect(parseBusinessName('  ').ok).toBe(false);
    expect(parseBusinessName(5).ok).toBe(false);
  });
  it('ארוך מדי', () => {
    expect(parseBusinessName('א'.repeat(81)).ok).toBe(false);
  });
});

describe('clampWelcomeStep', () => {
  it('בטווח', () => {
    expect(clampWelcomeStep(-1)).toBe(0);
    expect(clampWelcomeStep(1)).toBe(1);
    expect(clampWelcomeStep(9)).toBe(2);
    expect(clampWelcomeStep(NaN)).toBe(0);
  });
});
