import { describe, it, expect } from 'vitest';
import { buildGalleryUrl, buildInviteMessageHtml, buildInviteMessageText } from './clientInviteMessage';
import { toHebrewDateString } from './hebrewDate';

describe('buildGalleryUrl', () => {
  it('builds the same /gallery/{id} URL as the invite email', () => {
    expect(buildGalleryUrl('https://example.com', 'abc')).toBe('https://example.com/gallery/abc');
  });

  it('strips trailing slashes from the site URL', () => {
    expect(buildGalleryUrl('https://example.com//', 'abc')).toBe('https://example.com/gallery/abc');
  });
});

const base = {
  clientName: 'רחל',
  galleryUrl: 'https://example.com/gallery/abc',
  accessCode: 'XY12AB',
};

describe('buildInviteMessageText', () => {
  it('matches the existing ready-to-send message exactly', () => {
    expect(buildInviteMessageText(base)).toBe(
      'היי רחל! 📸\n\nהגלריה שלך עם התמונות מוכנה לבחירה.\n\nקישור: https://example.com/gallery/abc\n\n🔑 קוד גישה:\nXY12AB\n\nמחכה לראות מה תבחרי! ✨'
    );
  });

  it('adds the expiry line in Hebrew date when expiresAt exists', () => {
    const msg = buildInviteMessageText({ ...base, expiresAt: '2026-10-20' });
    expect(msg).toContain(`🔑 קוד גישה:\nXY12AB\n\nהגלריה פתוחה לבחירה עד ${toHebrewDateString(new Date('2026-10-20'))}.`);
  });

  it('omits the expiry line for empty / invalid dates and never prints undefined', () => {
    expect(buildInviteMessageText({ ...base, expiresAt: '' })).not.toContain('פתוחה לבחירה עד');
    expect(buildInviteMessageText({ ...base, expiresAt: 'nope' })).not.toContain('פתוחה לבחירה עד');
    const noName = buildInviteMessageText({ galleryUrl: base.galleryUrl, accessCode: 'A1' });
    expect(noName.startsWith('היי ! 📸')).toBe(true);
    expect(noName).not.toContain('undefined');
  });
});

describe('buildInviteMessageHtml', () => {
  it('escapes free-text values and drops non-http logo URLs', () => {
    const html = buildInviteMessageHtml({
      ...base,
      clientName: '<b>רחל</b>',
      businessName: 'A"B <script>',
      logoUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('<b>רחל</b>');
    expect(html).toContain('&lt;b&gt;רחל&lt;/b&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  it('contains greeting, access code, CTA link and business name', () => {
    const html = buildInviteMessageHtml({ ...base, businessName: 'דינה צילום' });
    expect(html).toContain('היי רחל! 📸');
    expect(html).toContain('>XY12AB</span>');
    expect(html).toContain('href="https://example.com/gallery/abc"');
    expect(html).toContain('כניסה לגלריה');
    expect(html).toContain('✨ דינה צילום');
    expect(html).not.toContain('<img');
  });

  it('makes the code tap-to-select (user-select:all) with a copy hint, and keeps it out of the link', () => {
    const html = buildInviteMessageHtml(base);
    expect(html).toMatch(/user-select: all; -webkit-user-select: all;">XY12AB<\/span>/);
    expect(html).toContain('לחיצה ארוכה על הקוד להעתקה');
    expect(html).not.toMatch(/href="[^"]*XY12AB/);
  });

  it('shows the logo instead of the sparkle when logoUrl exists', () => {
    const html = buildInviteMessageHtml({ ...base, businessName: 'דינה', logoUrl: 'https://cdn/logo.png' });
    expect(html).toContain('<img src="https://cdn/logo.png"');
    expect(html).not.toContain('✨ דינה');
  });

  it('falls back to a generic header and adds the expiry with <br />', () => {
    const html = buildInviteMessageHtml({ ...base, expiresAt: '2026-10-20' });
    expect(html).toContain('✨ הגלריה שלך');
    expect(html).toContain(`<br />הגלריה פתוחה לבחירה עד ${toHebrewDateString(new Date('2026-10-20'))}.`);
  });
});

describe('invite message - לשון פנייה', () => {
  it('defaults to feminine and switches to masculine with clientGender m', () => {
    expect(buildInviteMessageText(base)).toContain('מחכה לראות מה תבחרי!');
    expect(buildInviteMessageText({ ...base, clientGender: 'm' })).toContain('מחכה לראות מה תבחר!');
    expect(buildInviteMessageHtml({ ...base, clientGender: 'm' })).toContain('מחכה לראות מה תבחר!');
    expect(buildInviteMessageHtml({ ...base, clientGender: 'f' })).toContain('מחכה לראות מה תבחרי!');
  });
});
