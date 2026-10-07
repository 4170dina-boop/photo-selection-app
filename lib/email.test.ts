import { describe, it, expect, vi, afterEach } from 'vitest';

// RESEND_API_KEY נקרא מ-process.env פעם אחת, בזמן טעינת המודול - אז כל טסט
// שצריך ערך שונה חייב לאפס את process.env ואז לייבא מחדש עם vi.resetModules().
describe('lib/email', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    vi.resetModules();
  });

  it('parses mixed selection ranges and invalid values for the owner selection email flow', async () => {
    const { parseSelectionNumbers } = await import('./email');
    const result = parseSelectionNumbers('3, 7, 12-15, 40, 99, hello, 2-2', 24, 20);

    expect(result.selected).toEqual([2, 3, 7, 12, 13, 14, 15]);
    expect(result.invalid).toEqual(['40', '99', 'hello']);
    expect(result.extraPhotos).toBe(0);
    expect(result.totalValidSelected).toBe(7);
  });

  it('extracts valid photo numbers from a client reply email and ignores website text', async () => {
    const { extractSelectionFromReplyText } = await import('./email');
    const result = extractSelectionFromReplyText('היי!\nמספרים: 3, 7, 12-15, 44, 999\nhttps://example.com/abc', 24, 20);

    expect(result.selected).toEqual([3, 7, 12, 13, 14, 15]);
    expect(result.invalid).toEqual(['44', '999']);
    expect(result.extraPhotos).toBe(0);
    expect(result.totalValidSelected).toBe(6);
  });

  it('sends inline selection emails with cid image attachments and no website links in the HTML', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendSelectionEmailWithInlinePhotos } = await import('./email');
    const result = await sendSelectionEmailWithInlinePhotos({
      to: 'client@example.com',
      clientName: 'משפחת כהן',
      businessName: 'דינה שוורץ',
      includedPhotos: 20,
      extraPhotoPrice: 40,
      photos: [
        { number: 3, filename: '3.jpg', contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAA=' },
        { number: 7, filename: '7.jpg', contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,BBB=' },
      ],
      dueDate: 'כ"ה בתשרי',
    });

    expect(result.sent).toBe(true);
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.html).toContain('cid:photo-3');
    expect(body.html).toContain('cid:photo-7');
    expect(body.html).not.toContain('http://');
    expect(body.attachments).toHaveLength(2);
    expect(body.attachments[0].cid).toBe('photo-3');
  });

  it('skips sending (no crash) when RESEND_API_KEY is not configured - matches how app/api/cron/tick keeps working without email set up', async () => {
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendGalleryInviteEmail } = await import('./email');
    const result = await sendGalleryInviteEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
    });

    expect(result.sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends via Resend and returns sent:true on success, with the access code embedded in the email', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendGalleryInviteEmail } = await import('./email');
    const result = await sendGalleryInviteEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
    });

    expect(result.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    // תקרת זמן - בקשה תקועה לא מחזיקה את ריצת ה-cron עד שהיא נהרגת
    expect(options.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(options.body as string);
    expect(body.to).toBe('client@example.com');
    expect(body.html).toContain('ABCD1234');
    // הקוד ניתן לסימון בהקשה אחת (user-select:all), עם רמז, ולא בתוך הקישור
    expect(body.html).toMatch(/user-select: all; -webkit-user-select: all;">ABCD1234<\/span>/);
    expect(body.html).toContain('לחיצה ארוכה על הקוד להעתקה');
    expect(body.html).not.toMatch(/href="[^"]*ABCD1234/);
  });

  it('returns sent:false with the response text when Resend replies with a non-ok status', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, text: async () => 'rate limited' });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendExpiryReminderEmail } = await import('./email');
    const result = await sendExpiryReminderEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
      expiresAt: new Date().toISOString(),
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe('rate limited');
  });

  it('sends a selection-complete notification to the photographer with the selected count and dashboard link', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendSelectionCompleteEmail } = await import('./email');
    const result = await sendSelectionCompleteEmail({
      to: 'photographer@example.com',
      clientName: 'לקוחה',
      selectedCount: 12,
      dashboardUrl: 'http://localhost/dashboard/galleries/1/edit',
    });

    expect(result.sent).toBe(true);
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.to).toBe('photographer@example.com');
    expect(body.html).toContain('12');
    expect(body.html).toContain('http://localhost/dashboard/galleries/1/edit');
  });

  it('sends a shoot confirmation branded with the business name, with escaped location and without private notes', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendShootConfirmationEmail } = await import('./email');
    const result = await sendShootConfirmationEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו דינה',
      shootDate: '2026-10-11',
      startTime: '17:30:00',
      location: 'פארק <הירקון>',
      replyTo: 'photographer@example.com',
    });

    expect(result.sent).toBe(true);
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.from).toContain('"סטודיו דינה"');
    expect(body.reply_to).toBe('photographer@example.com');
    expect(body.html).toContain('יום ראשון, 11.10.2026');
    expect(body.html).toContain('17:30');
    expect(body.html).toContain('פארק &lt;הירקון&gt;');
  });

  it('never throws when fetch rejects - returns sent:false with the error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { sendGalleryInviteEmail } = await import('./email');
    const result = await sendGalleryInviteEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
    });
    expect(result).toEqual({ sent: false, error: 'network down' });
  });

  it('does not throw when reading the error body fails', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream broken');
      },
    }) as unknown as typeof fetch;

    const { sendGalleryInviteEmail } = await import('./email');
    const result = await sendGalleryInviteEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
    });
    expect(result).toEqual({ sent: false, error: 'HTTP 500' });
  });

  it('retries once on HTTP 429', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendGalleryInviteEmail } = await import('./email');
    const result = await sendGalleryInviteEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      galleryUrl: 'http://localhost/gallery/1',
      accessCode: 'ABCD1234',
    });
    expect(result.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('escapes every interpolated value and drops non-http(s) links', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendReviewRequestEmail, sendClientSelectionSummaryEmail } = await import('./email');
    await sendReviewRequestEmail({
      to: 'client@example.com',
      clientName: '<script>x</script>',
      businessName: 'Dina "Studio" <b>',
      reviewLink: 'javascript:alert(1)',
    });
    let body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
    expect(body.html).not.toContain('<b>"');
    expect(body.html).not.toContain('javascript:');
    expect(body.from).toBe('"Dina Studio b" <onboarding@resend.dev>');

    await sendClientSelectionSummaryEmail({
      to: 'client@example.com',
      clientName: 'לקוחה',
      businessName: 'סטודיו',
      filenames: ['<img src=x onerror=alert(1)>.jpg'],
    });
    body = JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.html).not.toContain('<img');
    expect(body.html).toContain('&lt;img src=x onerror=alert(1)&gt;.jpg');
  });

  it('attribute-escapes http(s) CTA links', async () => {
    const { safeHref, escapeHtml, sanitizeDisplayName, retryDelayMs } = await import('./email');
    expect(safeHref('https://example.com/a?x="1"&y=2')).toBe('https://example.com/a?x=%221%22&amp;y=2');
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(escapeHtml(`a'b"c`)).toBe('a&#39;b&quot;c');
    expect(sanitizeDisplayName('A "B"\r\nBcc: x@y <z>\\')).toBe('A B Bcc: x@y z');
    expect(retryDelayMs('2')).toBe(2000);
    expect(retryDelayMs('999')).toBe(5000);
    expect(retryDelayMs(null)).toBe(1000);
  });

  it('sends the photographer a daily summary listing tomorrow\'s shoots', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { sendShootsDailySummaryEmail } = await import('./email');
    const result = await sendShootsDailySummaryEmail({
      to: 'photographer@example.com',
      shootDate: '2026-10-11',
      shoots: [
        { clientName: 'רחל', startTime: '09:00:00', location: 'סטודיו', notes: 'להביא רקע לבן' },
        { clientName: 'לאה', startTime: '17:30:00', location: 'חוף הים' },
      ],
      dashboardUrl: 'http://localhost/dashboard/calendar',
    });

    expect(result.sent).toBe(true);
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.subject).toContain('2 צילומים');
    expect(body.html).toContain('רחל');
    expect(body.html).toContain('להביא רקע לבן');
    expect(body.html).toContain('http://localhost/dashboard/calendar');
  });
});

describe('parseAdditionalInviteEmails', () => {
  it('treats missing values as an empty list', async () => {
    const { parseAdditionalInviteEmails } = await import('./email');
    expect(parseAdditionalInviteEmails(undefined)).toEqual({ ok: true, value: [] });
    expect(parseAdditionalInviteEmails(null)).toEqual({ ok: true, value: [] });
  });

  it('trims and drops empty strings', async () => {
    const { parseAdditionalInviteEmails } = await import('./email');
    expect(parseAdditionalInviteEmails([' a@b.co ', '', '  '])).toEqual({ ok: true, value: ['a@b.co'] });
  });

  it('rejects non-arrays and non-string entries', async () => {
    const { parseAdditionalInviteEmails } = await import('./email');
    expect(parseAdditionalInviteEmails('a@b.co').ok).toBe(false);
    expect(parseAdditionalInviteEmails({}).ok).toBe(false);
    expect(parseAdditionalInviteEmails(['a@b.co', 5]).ok).toBe(false);
    expect(parseAdditionalInviteEmails([null]).ok).toBe(false);
  });

  it('rejects invalid emails', async () => {
    const { parseAdditionalInviteEmails } = await import('./email');
    expect(parseAdditionalInviteEmails(['not-an-email']).ok).toBe(false);
  });

  it('caps the list at 10 addresses', async () => {
    const { parseAdditionalInviteEmails } = await import('./email');
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}@x.co`);
    expect(parseAdditionalInviteEmails(ten).ok).toBe(true);
    expect(parseAdditionalInviteEmails([...ten, 'u10@x.co']).ok).toBe(false);
  });
});

describe('lib/email - לשון פנייה (clientGender)', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    vi.resetModules();
  });

  it('genders photographer notifications and the review request by client gender', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendSelectionCompleteEmail, sendQuotaReachedEmail, sendReviewRequestEmail, sendExtensionRequestedEmail } =
      await import('./email');
    const bodyAt = (i: number) => JSON.parse((fetchSpy.mock.calls[i] as [string, RequestInit])[1].body as string);

    await sendSelectionCompleteEmail({ to: 'p@x.co', clientName: 'דני', clientGender: 'm', selectedCount: 3, dashboardUrl: 'https://x.co' });
    expect(bodyAt(0).subject).toBe('דני סיים לבחור תמונות');
    await sendSelectionCompleteEmail({ to: 'p@x.co', clientName: 'רחל', selectedCount: 3, dashboardUrl: 'https://x.co' });
    expect(bodyAt(1).subject).toBe('רחל סיימה לבחור תמונות');

    await sendQuotaReachedEmail({ to: 'p@x.co', clientName: 'דני', clientGender: 'm', includedPhotos: 30, dashboardUrl: 'https://x.co' });
    expect(bodyAt(2).subject).toContain('דני הגיע למכסת');
    expect(bodyAt(2).html).toContain('הוא עדיין יכול');

    await sendReviewRequestEmail({ to: 'c@x.co', clientName: 'דני', clientGender: 'm', businessName: 'סטודיו', reviewLink: 'https://x.co/r' });
    expect(bodyAt(3).html).toContain('מקווה שאתה נהנה');

    await sendExtensionRequestedEmail({ to: 'p@x.co', clientName: 'דני', clientGender: 'm', days: 2, currentExpiresAt: null, dashboardUrl: 'https://x.co' });
    expect(bodyAt(4).subject).toBe('הלקוח דני ביקש הארכה של 2 ימים');
  });
});

describe('lib/email - אוטומציות (מייל "לפני שנה", תאריכים בסיכום היומי)', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    vi.resetModules();
  });

  it('sends the anniversary email in the gallery language and client gender, with logo and reply-to', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendAnniversaryEmail } = await import('./email');
    const bodyAt = (i: number) => JSON.parse((fetchSpy.mock.calls[i] as [string, RequestInit])[1].body as string);

    await sendAnniversaryEmail({
      to: 'c@x.co',
      clientName: 'דני',
      clientGender: 'm',
      businessName: 'סטודיו <b>',
      logoUrl: 'https://x.supabase.co/storage/v1/object/public/photographer-logos/p/logo?t=1',
      galleryUrl: 'https://x.co/gallery/1',
      accessCode: 'ABCD1234',
      replyTo: 'photographer@x.co',
    });
    const he = bodyAt(0);
    expect(he.subject).toBe('לפני שנה צילמנו 💛');
    expect(he.reply_to).toBe('photographer@x.co');
    expect(he.html).toContain('מקווה שאתה עדיין נהנה');
    expect(he.html).toContain('<img src="https://x.supabase.co/storage/v1/object/public/photographer-logos/p/logo?t=1"');
    expect(he.html).toContain('סטודיו &lt;b&gt;');
    expect(he.html).toContain('dir="rtl"');

    await sendAnniversaryEmail({
      language: 'en',
      to: 'c@x.co',
      clientName: 'Dan',
      businessName: 'Studio',
      logoUrl: 'javascript:alert(1)',
      galleryUrl: 'https://x.co/gallery/1',
    });
    const en = bodyAt(1);
    expect(en.subject).toBe('A year ago we did a photo shoot together 💛');
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).not.toContain('<img');
  });

  it('daily summary: dates only (no shoots) still sends, with the reminder line and suggestion', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendShootsDailySummaryEmail, dailySummarySubject } = await import('./email');

    const result = await sendShootsDailySummaryEmail({
      to: 'p@x.co',
      shootDate: '2026-10-07',
      shoots: [],
      dateReminders: [
        { label: 'יום ההולדת של יוסי', clientLabel: 'משפחת כהן', daysAhead: 30, dateText: '5.11.2026', suggestion: 'ברכה' },
      ],
      dashboardUrl: 'https://x.co/dashboard/calendar',
      datesDashboardUrl: 'https://x.co/dashboard/clients',
    });
    expect(result.sent).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.subject).toBe('📅 בעוד 30 יום: יום ההולדת של יוסי');
    expect(body.html).toContain('📅 בעוד 30 יום: <b>יום ההולדת של יוסי</b> (משפחת כהן)');
    expect(body.html).toContain('https://x.co/dashboard/clients');
    expect(body.html).not.toContain('מחר (');

    expect(dailySummarySubject(2, [])).toBe('הצילומים שלך מחר: 2 צילומים');
    expect(dailySummarySubject(1, [{ label: 'a', daysAhead: 30 }])).toBe('הצילומים שלך מחר: צילום אחד · תאריך חשוב אחד');
    expect(dailySummarySubject(0, [{ label: 'a', daysAhead: 30 }, { label: 'b', daysAhead: 30 }])).toBe('📅 2 תאריכים חשובים של לקוחות מתקרבים');
  });
});
