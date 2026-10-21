import { createClient } from '@supabase/supabase-js';

const KEY_PREFIX = 'personal_note:';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function fetchPersonalNote(_supabase: unknown, galleryId: string): Promise<string | null> {
  const { data } = await adminClient()
    .from('app_settings')
    .select('value')
    .eq('key', KEY_PREFIX + galleryId)
    .maybeSingle();
  return data?.value ?? null;
}

export async function savePersonalNote(_supabase: unknown, galleryId: string, note: string | null | undefined): Promise<void> {
  if (note === undefined) return;
  const trimmed = note?.trim() || null;
  const admin = adminClient();
  if (trimmed) {
    await admin
      .from('app_settings')
      .upsert({ key: KEY_PREFIX + galleryId, value: trimmed }, { onConflict: 'key' });
  } else {
    await admin
      .from('app_settings')
      .delete()
      .eq('key', KEY_PREFIX + galleryId);
  }
}
