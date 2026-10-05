import { describe, it, expect } from 'vitest';
import { extractAccessCode, normalizePastedCode } from './accessCodePaste';
import { buildInviteMessageText } from './clientInviteMessage';

describe('normalizePastedCode', () => {
  it('trims, uppercases and strips spaces/dashes', () => {
    expect(normalizePastedCode('  ab12-cd34 ')).toBe('AB12CD34');
    expect(normalizePastedCode('ab 12 cd 34')).toBe('AB12CD34');
    expect(normalizePastedCode('AB12–CD34')).toBe('AB12CD34');
  });

  it('strips invisible direction marks and WhatsApp formatting', () => {
    expect(normalizePastedCode('‏ab12cd34‎')).toBe('AB12CD34');
    expect(normalizePastedCode('*AB12CD34*')).toBe('AB12CD34');
    expect(normalizePastedCode('﻿ab12​cd34\n')).toBe('AB12CD34');
  });

  it('returns empty string for empty / whitespace input', () => {
    expect(normalizePastedCode('')).toBe('');
    expect(normalizePastedCode('  \n ')).toBe('');
  });
});

describe('extractAccessCode', () => {
  it('normalises a plain code', () => {
    expect(extractAccessCode(' ab12cd34 ')).toBe('AB12CD34');
  });

  it('extracts the code from "קוד גישה: XXXX" on the same line', () => {
    expect(extractAccessCode('קישור: https://x.com/gallery/abc\nקוד גישה: ab12cd34\n\nמחכה')).toBe('AB12CD34');
    expect(extractAccessCode('קוד הגישה - AB12-CD34')).toBe('AB12CD34');
    expect(extractAccessCode('קוד גישה: *AB12CD34*')).toBe('AB12CD34');
  });

  it('extracts the code when it is on the line after the label', () => {
    expect(extractAccessCode('🔑 קוד גישה:\nAB12CD34\n\nהגלריה פתוחה')).toBe('AB12CD34');
  });

  it('extracts the code from the full ready-to-send invite message', () => {
    const msg = buildInviteMessageText({
      clientName: 'רחל',
      galleryUrl: 'https://example.com/gallery/0f3a-uuid',
      accessCode: 'XY12AB34',
      expiresAt: '2026-10-20',
    });
    expect(extractAccessCode(msg)).toBe('XY12AB34');
  });

  it('ignores invisible marks around the label and code', () => {
    expect(extractAccessCode('‏קוד גישה:‏ ‎AB12CD34‎')).toBe('AB12CD34');
  });
});
