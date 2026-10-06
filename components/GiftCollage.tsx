'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatDateWithHebrew, langDir, t, type Lang } from '@/lib/i18n';
import {
  COLLAGE_WIDTH,
  COLLAGE_HEIGHT,
  COLLAGE_MIN_PHOTOS,
  COLLAGE_PADDING,
  COLLAGE_HEADER_HEIGHT,
  COLLAGE_GAP,
  collageCells,
  collagePhotoArea,
  assignPhotosToCells,
  coverCrop,
  collageFileName,
  pickCollagePhotos,
  type Rect,
} from '@/lib/collage';

// קולאז' מתנה אוטומטי במסך התודה אחרי "סיימתי לבחור" (#11). נבנה כולו בצד
// הלקוחה על <canvas>, רק מהתצוגות עם סימן המים (fullUrl) - המקור הנקי לא נחשף.
//
// למה fetch → blob ולא <img crossOrigin>: ה-URLs החתומים של R2 הם cross-origin,
// וציור ישיר שלהם מ-<img> רגיל "מכתים" את הקנבס (toBlob זורק SecurityError).
// fetch עם CORS מחזיר blob מקומי שאפשר לפענח ולצייר בלי הכתמה - אותה גישה
// כמו הורדת ה-ZIP. דורש כלל CORS עם GET על ה-bucket (README, "חובה: כלל CORS").
// בלי הכלל ה-fetch נכשל, וכל תמונה שנכשלה פשוט מדולגת; פחות מ-3 → הודעה קצרה
// בלי כפתור הורדה.

export interface CollagePhoto {
  id: string;
  fullUrl: string | null;
  isGift?: boolean;
}

type Status = 'rendering' | 'ready' | 'unavailable';

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

// כמה תמונות גיבוי לכל היותר מנסים לטעון אם חלק מהראשיות נכשלו
const MAX_BACKUP_TRIES = 6;

async function decodeBlob(blob: Blob): Promise<Decoded | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    }
  } catch {
    // נופלים ל-<img> מ-object URL (Safari ישן / פורמט ש-createImageBitmap לא מכיר)
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

async function loadImage(url: string | null | undefined): Promise<Decoded | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') && blob.type !== '' && blob.type !== 'application/octet-stream') return null;
    const decoded = await decodeBlob(blob);
    if (!decoded || decoded.width <= 0 || decoded.height <= 0) {
      decoded?.close();
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function cssFontFamily(varName: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch {
    return fallback;
  }
}

function roundedRectPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

// מקטין את הגופן עד שהטקסט נכנס לרוחב הנתון
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, maxWidth: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
}

function drawCollage(
  canvas: HTMLCanvasElement,
  images: Decoded[],
  opts: { accent: string; photographerName: string | null; logo: Decoded | null; serif: string; sans: string; date: Date; lang: Lang },
) {
  canvas.width = COLLAGE_WIDTH;
  canvas.height = COLLAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const W = COLLAGE_WIDTH;
  const H = COLLAGE_HEIGHT;

  // רקע: הנייבי של הפלטה עם מעבר עדין, ומסגרת דקה בצבע המותג
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.panel);
  bg.addColorStop(1, theme.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = opts.accent;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, { x: 20, y: 20, w: W - 40, h: H - 40 }, 26);
  ctx.stroke();
  ctx.restore();

  ctx.direction = langDir(opts.lang);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // כותרת: לוגו בעיגול (אם יש) + שם העסק
  const cx = W / 2;
  const name = opts.photographerName?.trim() || '';
  if (opts.logo) {
    const r = 40;
    const cy = 76;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.panelInput;
    ctx.fill();
    ctx.clip();
    // contain בתוך העיגול - לוגו לא אמור להיחתך
    const scale = Math.min((r * 2) / opts.logo.width, (r * 2) / opts.logo.height);
    const lw = opts.logo.width * scale;
    const lh = opts.logo.height * scale;
    ctx.drawImage(opts.logo.source, cx - lw / 2, cy - lh / 2, lw, lh);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = opts.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (name) {
      ctx.fillStyle = theme.text;
      fitFont(ctx, name, 500, 30, opts.serif, W - COLLAGE_PADDING * 4);
      ctx.fillText(name, cx, 148);
    }
  } else if (name) {
    ctx.fillStyle = theme.text;
    fitFont(ctx, name, 500, 46, opts.serif, W - COLLAGE_PADDING * 4);
    ctx.fillText(name, cx, 100);
    ctx.fillStyle = opts.accent;
    ctx.fillRect(cx - 40, 124, 80, 2);
  } else {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(cx - 40, COLLAGE_HEADER_HEIGHT / 2, 80, 2);
  }

  // התמונות
  const aspects = images.map((im) => im.width / im.height);
  const cells = collageCells(images.length, collagePhotoArea(), COLLAGE_GAP, aspects[0] < 1);
  const assignment = assignPhotosToCells(cells, aspects);
  cells.forEach((cell, i) => {
    const im = images[assignment[i]];
    ctx.save();
    roundedRectPath(ctx, cell, 16);
    ctx.fillStyle = theme.panelInput;
    ctx.fill();
    ctx.clip();
    const crop = coverCrop(im.width, im.height, cell.w, cell.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im.source, crop.x, crop.y, crop.w, crop.h, cell.x, cell.y, cell.w, cell.h);
    ctx.restore();
  });

  // שורת תחתית: "הבחירה שלי ✨" + תאריך (לועזי ועברי בעברית/יידיש)
  const area = collagePhotoArea();
  const footerTop = area.y + area.h;
  ctx.fillStyle = opts.accent;
  ctx.font = `500 48px ${opts.serif}`;
  ctx.fillText(t(opts.lang, 'col.canvasTitle'), cx, footerTop + 70);
  ctx.fillStyle = theme.textMuted;
  const dateLine = formatDateWithHebrew(opts.lang, opts.date);
  fitFont(ctx, dateLine, 400, 26, opts.sans, W - COLLAGE_PADDING * 2);
  ctx.fillText(dateLine, cx, footerTop + 112);
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
    } catch {
      // SecurityError (קנבס מוכתם) - לא אמור לקרות עם blob-ים, אבל ליתר ביטחון
      resolve(null);
    }
  });
}

export default function GiftCollage(props: {
  photos: CollagePhoto[];
  statuses: Record<string, 'maybe' | 'selected' | undefined>;
  photographerName: string | null;
  photographerLogo: string | null;
  accent: string;
  buttonStyle?: React.CSSProperties;
  // שם לקובץ ההורדה (למשל שם הלקוחה) - עובר sanitise ב-collageFileName
  fileLabel?: string | null;
  // מרענן את ה-URLs החתומים (תוקף שעה) - ניסיון חוזר אחד לתמונות שנכשלו
  refreshPhotos?: () => Promise<CollagePhoto[] | null>;
  // שפת התצוגה וכיתוב הקולאז' (lib/i18n) - חסר = עברית
  lang?: Lang;
}) {
  const { photos, statuses, photographerName, photographerLogo, accent } = props;
  const lang: Lang = props.lang ?? 'he';

  const picks = useMemo(() => {
    const selected = photos.filter((p) => !p.isGift && statuses[p.id] === 'selected').map((p) => p.id);
    const gifts = photos.filter((p) => p.isGift).map((p) => p.id);
    const maybe = photos.filter((p) => !p.isGift && statuses[p.id] === 'maybe').map((p) => p.id);
    return pickCollagePhotos({ selected, gifts, maybe });
  }, [photos, statuses]);
  // הקולאז' נבנה מחדש רק כשבחירת התמונות עצמה משתנה - לא בכל ריענון של
  // ה-URLs החתומים (הגלריה מתרעננת ברקע ומחזירה URLs חדשים לאותן תמונות)
  const picksKey = `${picks.primary.join(',')}|${picks.backups.join(',')}`;

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const refreshRef = useRef(props.refreshPhotos);
  refreshRef.current = props.refreshPhotos;
  const brandRef = useRef({ accent, photographerName, photographerLogo, lang });
  brandRef.current = { accent, photographerName, photographerLogo, lang };

  const [status, setStatus] = useState<Status>('rendering');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [shareError, setShareError] = useState('');

  const enoughCandidates = picks.primary.length >= COLLAGE_MIN_PHOTOS;

  useEffect(() => {
    if (!enoughCandidates) return;
    let cancelled = false;
    const loaded: Decoded[] = [];
    let logo: Decoded | null = null;
    setStatus('rendering');
    setBlob(null);

    (async () => {
      const urlOf = (id: string, list: CollagePhoto[]) => list.find((p) => p.id === id)?.fullUrl ?? null;
      const target = picks.primary.length;
      const results = await Promise.all(picks.primary.map((id) => loadImage(urlOf(id, photosRef.current))));
      if (cancelled) return results.forEach((r) => r?.close());

      const byId = new Map<string, Decoded>();
      const failed: string[] = [];
      picks.primary.forEach((id, i) => {
        const r = results[i];
        if (r) byId.set(id, r);
        else failed.push(id);
      });

      // כנראה חתימה שפגה - מרעננים פעם אחת ומנסים שוב את מה שנכשל
      let freshList: CollagePhoto[] = photosRef.current;
      if (failed.length > 0 && refreshRef.current) {
        const fresh = await refreshRef.current().catch(() => null);
        if (fresh) freshList = fresh;
        const retry = await Promise.all(failed.map((id) => loadImage(urlOf(id, freshList))));
        if (cancelled) return [...byId.values(), ...retry].forEach((r) => r?.close());
        failed.forEach((id, i) => {
          const r = retry[i];
          if (r) byId.set(id, r);
        });
      }

      // ועדיין חסר - משלימים מתמונות גיבוי (נבחרות/מתנות אחרות)
      let tries = 0;
      for (const id of picks.backups) {
        if (byId.size >= target || tries >= MAX_BACKUP_TRIES) break;
        tries++;
        const r = await loadImage(urlOf(id, freshList));
        if (cancelled) {
          r?.close();
          return [...byId.values()].forEach((d) => d.close());
        }
        if (r) byId.set(id, r);
      }

      // שומרים על סדר העדיפויות (ראשיות קודם, אחר כך גיבויים לפי הסדר)
      for (const id of [...picks.primary, ...picks.backups]) {
        const d = byId.get(id);
        if (d && loaded.length < target) loaded.push(d);
        else d?.close();
      }

      if (loaded.length < COLLAGE_MIN_PHOTOS) {
        if (!cancelled) setStatus('unavailable');
        return;
      }

      const brand = brandRef.current;
      logo = brand.photographerLogo ? await loadImage(brand.photographerLogo) : null;
      if (cancelled) return;

      const serif = cssFontFamily('--font-serif', 'serif');
      const sans = cssFontFamily('--font-sans', 'sans-serif');
      try {
        await Promise.all([
          document.fonts?.load(`500 48px ${serif}`, t(brand.lang, 'col.canvasTitle')),
          document.fonts?.load(`400 26px ${sans}`, 'תשפ״ז 2026'),
        ]);
      } catch {
        // בלי הגופן המותאם - נצייר עם ה-fallback
      }
      if (cancelled) return;

      const canvas = document.createElement('canvas');
      let out: Blob | null = null;
      try {
        drawCollage(canvas, loaded, {
          accent: brand.accent,
          photographerName: brand.photographerName,
          logo,
          serif,
          sans,
          date: new Date(),
          lang: brand.lang,
        });
        out = await canvasToJpeg(canvas);
      } catch {
        out = null;
      }
      // משחררים זיכרון מיד - ה-JPEG המוכן הוא כל מה שצריך מעכשיו
      canvas.width = 0;
      canvas.height = 0;
      loaded.forEach((d) => d.close());
      loaded.length = 0;
      logo?.close();
      logo = null;
      if (cancelled) return;
      if (!out) {
        setStatus('unavailable');
        return;
      }
      setBlob(out);
      setStatus('ready');
    })();

    return () => {
      cancelled = true;
      loaded.forEach((d) => d.close());
      logo?.close();
    };
    // picksKey מייצג את picks במלואו
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // lang - הכיתוב על הקולאז' מתחלף עם השפה
  }, [picksKey, enoughCandidates, lang]);

  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const fileName = collageFileName(props.fileLabel, t(lang, 'col.fileName'));

  useEffect(() => {
    if (!blob) return;
    try {
      // "שמירה לטלפון" רק במכשירי מגע עם share sheet שתומך בקבצים - בדסקטופ
      // הורדה רגילה ברורה יותר
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      setCanShareFiles(coarse && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
    } catch {
      setCanShareFiles(false);
    }
  }, [blob, fileName]);

  function handleDownload() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // שחרור מיידי עלול לבטל את ההורדה בחלק מהדפדפנים (בעיקר Safari/Firefox)
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function handleShare() {
    if (!blob) return;
    setShareError('');
    try {
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: t(lang, 'col.canvasTitle') });
    } catch (err) {
      // ביטול של הלקוחה (AbortError) הוא לא שגיאה
      if ((err as Error)?.name === 'AbortError') return;
      setShareError(t(lang, 'col.shareFailed'));
    }
  }

  if (!enoughCandidates) return null;

  return (
    <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: `1px solid ${theme.border}` }}>
      <style>{`
        @keyframes giftCollagePulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes giftCollageIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .gift-collage-skeleton { animation: giftCollagePulse 1.4s ease-in-out infinite; }
        .gift-collage-img { animation: giftCollageIn 0.5s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .gift-collage-skeleton, .gift-collage-img { animation: none; }
        }
      `}</style>
      <p style={{ fontSize: 16, fontFamily: theme.fontSerif, color: theme.text, marginBottom: '0.25rem' }}>
        {t(lang, 'col.title')}
      </p>
      <p style={{ color: theme.textFaint, fontSize: 12, marginBottom: '0.9rem' }}>
        {t(lang, 'col.sub')}
      </p>

      {status === 'rendering' && (
        <div
          role="status"
          aria-label={t(lang, 'col.rendering')}
          className="gift-collage-skeleton"
          style={{
            width: 'min(280px, 100%)', aspectRatio: `${COLLAGE_WIDTH} / ${COLLAGE_HEIGHT}`, margin: '0 auto',
            borderRadius: 12, background: theme.panelInput, border: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textFaint, fontSize: 13,
          }}
        >
          {t(lang, 'col.rendering')}
        </div>
      )}

      {status === 'unavailable' && (
        <p role="status" style={{ color: theme.textFaint, fontSize: 13 }}>
          {t(lang, 'col.unavailable')}
        </p>
      )}

      {status === 'ready' && previewUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={t(lang, 'col.alt')}
            className="gift-collage-img"
            style={{
              display: 'block', width: 'min(280px, 100%)', height: 'auto', margin: '0 auto', borderRadius: 12,
              border: `1px solid ${accent}55`, boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
          />
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
            <button onClick={handleDownload} style={{ ...goldButtonStyle, ...props.buttonStyle, minHeight: 44 }}>
              {t(lang, 'col.download')}
            </button>
            {canShareFiles && (
              <button onClick={handleShare} style={{ ...outlineButtonStyle, minHeight: 44, borderColor: `${accent}88`, color: theme.text }}>
                {t(lang, 'col.share')}
              </button>
            )}
          </div>
          {shareError && (
            <p role="alert" style={{ color: theme.errorText, fontSize: 12, marginTop: '0.6rem' }}>{shareError}</p>
          )}
        </>
      )}
    </div>
  );
}
