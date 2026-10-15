import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractSelectionFromReplyText } from '@/lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// קליטת תשובת מייל מהלקוחה (ספק המיילים שולח לכאן webhook). הנתיב משתמש
// ב-service_role וכותב בחירות בשם הבעלים - לכן הוא חייב להיות מוגן בסוד
// משותף שרק ספק המיילים מכיר. בלי EMAIL_REPLY_WEBHOOK_SECRET מוגדר ב-Vercel
// הנתיב מסרב לכל בקשה (fail closed) - בלי זה כל אחד שמכיר את מזהה הגלריה היה
// יכול למחוק/לשנות את הבחירות של הלקוחה בלי קוד גישה ובלי התחברות.
function webhookSecretOk(req: NextRequest): boolean {
  const expected = process.env.EMAIL_REPLY_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-webhook-secret') ?? '';
  // השוואה בזמן קבוע כדי לא לדלוף את אורך/תוכן הסוד דרך תזמון
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;

  if (!webhookSecretOk(req)) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
  }

  let body: { text?: unknown; body?: unknown; from?: unknown; fromEmail?: unknown; sender?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה לא תקין' }, { status: 400 });
  }

  const replyText = typeof body.text === 'string' ? body.text : typeof body.body === 'string' ? body.body : '';
  const senderEmail =
    typeof body.from === 'string'
      ? body.from
      : typeof body.fromEmail === 'string'
      ? body.fromEmail
      : typeof body.sender === 'string'
      ? body.sender
      : '';

  if (!replyText.trim()) {
    return NextResponse.json({ error: 'אין טקסט של תשובה' }, { status: 400 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, owner_participant_id, clients(email)')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // התאמת שולח: חובה שתגיע כתובת שולח, והיא חייבת להתאים למייל של הלקוחה.
  // קודם הבדיקה דולגה כשלא הגיעה כתובת שולח - כך שאפשר היה פשוט להשמיט אותה
  // כדי לכתוב בחירות בשם הבעלים. עכשיו היעדר שולח (או אי-התאמה) נדחה.
  const clientEmail = (gallery as any).clients?.email as string | undefined;
  if (!clientEmail) {
    return NextResponse.json({ error: 'לגלריה אין מייל לקוחה לאימות מול השולח' }, { status: 400 });
  }
  if (!senderEmail || senderEmail.toLowerCase() !== clientEmail.toLowerCase()) {
    return NextResponse.json({ error: 'השולח אינו הלקוחה של הגלריה' }, { status: 403 });
  }

  if (!gallery.owner_participant_id) {
    return NextResponse.json({ error: 'אין בעלים מאומת לגלריה' }, { status: 400 });
  }

  const { data: photos, error: photosError } = await supabaseAdmin
    .from('photos')
    .select('id')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: true });

  if (photosError) {
    return NextResponse.json({ error: 'לא ניתן לטעון את התמונות של הגלריה' }, { status: 500 });
  }

  const result = extractSelectionFromReplyText(replyText, photos?.length ?? 0);
  const validPhotoIds = result.selected
    .map((number) => (photos ?? [])[number - 1]?.id)
    .filter((id): id is string => Boolean(id));

  const { error: deleteError } = await supabaseAdmin
    .from('selections')
    .delete()
    .eq('gallery_id', galleryId)
    .eq('participant_id', gallery.owner_participant_id);

  if (deleteError) {
    return NextResponse.json({ error: 'נכשל למחוק בחירות קיימות' }, { status: 500 });
  }

  if (validPhotoIds.length > 0) {
    const rows = validPhotoIds.map((photoId) => ({
      gallery_id: galleryId,
      photo_id: photoId,
      participant_id: gallery.owner_participant_id,
      status: 'selected' as const,
    }));

    const { error: upsertError } = await supabaseAdmin.from('selections').upsert(rows, {
      onConflict: 'gallery_id,photo_id,participant_id',
    });

    if (upsertError) {
      return NextResponse.json({ error: 'נכשל להכניס בחירה חדשה' }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    selectedCount: validPhotoIds.length,
    invalid: result.invalid,
    totalValidSelected: result.totalValidSelected,
  });
}
