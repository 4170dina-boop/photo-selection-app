import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { downloadToBuffer } from '@/lib/r2';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { hasWatermarkedThumbnail, isKeyInGallery } from '@/lib/uploadPolicy';
import { sendSelectionEmailWithAttachments } from '@/lib/email';
import {
  TEST_EMAIL_PHOTOS,
  packBySize,
  photoFilename,
  planEmailParts,
} from '@/lib/emailSelectionBatches';

// בחירה במייל (משימה 21) - ראו lib/emailSelectionBatches.ts. הדפדפן של הצלמת
// מבקש קודם תוכנית (mode=plan), ואז שולח חלק אחרי חלק (mode=send) כדי שכל
// בקשה תסתיים בזמן. mode=test שולח את התמונות הראשונות למייל של הצלמת עצמה.
export const maxDuration = 60;

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_EDGE_PX = 1200;
const EMAIL_JPEG_QUALITY = 80;
const DOWNLOAD_CONCURRENCY = 6;

type PhotoRow = { id: string; file_path: string; thumbnail_path: string | null };

async function loadContext(galleryId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'לא מחוברת' }, { status: 401 }) };

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .single();
  if (!photographer) return { error: NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 }) };

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('id, expires_at, photographer_id, clients(full_name, email)')
    .eq('id', galleryId)
    .eq('photographer_id', photographer.id)
    .single();
  if (!gallery) return { error: NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 }) };

  const { data: pkg } = await supabaseAdmin
    .from('packages')
    .select('included_photos, extra_photo_price')
    .eq('gallery_id', galleryId)
    .maybeSingle();

  // אותו סדר ואותו סינון כמו app/api/gallery/[id]/route.ts - המספרים במייל
  // חייבים להיות זהים למספרים שהלקוחה רואה בגלריה.
  const rows = await fetchAllPages<PhotoRow>((from, to) =>
    supabaseAdmin
      .from('photos')
      .select('id, file_path, thumbnail_path')
      .eq('gallery_id', galleryId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );
  const photos = rows.filter(hasWatermarkedThumbnail);

  const client = (gallery as any).clients ?? {};
  return {
    user,
    photographer,
    gallery,
    photos,
    clientName: (client.full_name as string) || '',
    clientEmail: (client.email as string) || '',
    includedPhotos: pkg?.included_photos ?? 0,
    extraPhotoPrice: pkg?.extra_photo_price ?? 0,
  };
}

async function prepareAttachment(galleryId: string, photo: PhotoRow, number: number, total: number) {
  const key = photo.thumbnail_path as string;
  if (!isKeyInGallery(galleryId, key)) return null;
  const source = await downloadToBuffer(key);
  if (!source) return null;
  const resized = await sharp(source)
    .resize(EMAIL_EDGE_PX, EMAIL_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: EMAIL_JPEG_QUALITY })
    .toBuffer();
  return { number, filename: photoFilename(number, total), base64Content: resized.toString('base64'), bytes: resized.length };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { mode?: unknown; part?: unknown; to?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  let ctx: Awaited<ReturnType<typeof loadContext>>;
  try {
    ctx = await loadContext(params.id);
  } catch {
    return NextResponse.json({ error: 'טעינת הגלריה נכשלה' }, { status: 500 });
  }
  if ('error' in ctx) return ctx.error;

  const total = ctx.photos.length;
  const parts = planEmailParts(total);

  if (body.mode === 'plan') {
    return NextResponse.json({ total, parts, clientEmail: ctx.clientEmail, myEmail: ctx.user.email ?? '' });
  }

  let to: string;
  let range: { from: number; to: number };
  const isTest = body.mode === 'test';
  if (isTest) {
    to = ctx.user.email ?? '';
    range = { from: 1, to: Math.min(total, TEST_EMAIL_PHOTOS) };
  } else if (body.mode === 'send') {
    to = typeof body.to === 'string' ? body.to.trim() : ctx.clientEmail;
    const part = parts.find((p) => p.index === body.part);
    if (!part) return NextResponse.json({ error: 'חלק לא קיים' }, { status: 400 });
    range = part;
  } else {
    return NextResponse.json({ error: 'פעולה לא מוכרת' }, { status: 400 });
  }

  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'כתובת המייל לא תקינה' }, { status: 400 });
  if (total === 0) return NextResponse.json({ error: 'אין בגלריה תמונות מוכנות' }, { status: 400 });

  const slice = ctx.photos.slice(range.from - 1, range.to);
  const prepared: NonNullable<Awaited<ReturnType<typeof prepareAttachment>>>[] = [];
  try {
    for (let i = 0; i < slice.length; i += DOWNLOAD_CONCURRENCY) {
      const chunk = slice.slice(i, i + DOWNLOAD_CONCURRENCY);
      const done = await Promise.all(chunk.map((p, j) => prepareAttachment(params.id, p, range.from + i + j, total)));
      done.forEach((d) => d && prepared.push(d));
    }
  } catch (err) {
    console.error('[email-selection] הכנת התמונות נכשלה:', err);
    return NextResponse.json({ error: 'הכנת התמונות נכשלה, נסי שוב' }, { status: 500 });
  }
  if (prepared.length === 0) return NextResponse.json({ error: 'לא נמצאו קבצי תמונות' }, { status: 500 });

  const dueDate = (ctx.gallery as any).expires_at
    ? new Date((ctx.gallery as any).expires_at).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })
    : null;

  let emails = 0;
  for (const group of packBySize(prepared)) {
    const result = await sendSelectionEmailWithAttachments({
      to,
      clientName: isTest ? ctx.clientName || 'לקוחה' : ctx.clientName,
      businessName: ctx.photographer.business_name,
      includedPhotos: ctx.includedPhotos,
      extraPhotoPrice: ctx.extraPhotoPrice,
      dueDate,
      totalPhotos: total,
      rangeFrom: group[0].number,
      rangeTo: group[group.length - 1].number,
      isTest,
      photos: group,
      replyTo: ctx.user.email ?? undefined,
    });
    if (!result.sent) {
      return NextResponse.json({ error: `שליחת המייל נכשלה: ${result.error ?? ''}`.trim(), emailsSent: emails }, { status: 502 });
    }
    emails++;
  }

  return NextResponse.json({ ok: true, to, from: range.from, to_number: range.to, photos: prepared.length, emailsSent: emails });
}
