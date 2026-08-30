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
});
