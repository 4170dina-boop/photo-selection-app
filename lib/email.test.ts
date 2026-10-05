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

    const body = JSON.parse(options.body as string);
    expect(body.to).toBe('client@example.com');
    expect(body.html).toContain('ABCD1234');
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
