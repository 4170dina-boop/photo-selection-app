type SupabaseClient = { from: (table: string) => any };

const KEY_PREFIX = 'personal_note:';

export async function fetchPersonalNote(supabase: SupabaseClient, galleryId: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', KEY_PREFIX + galleryId)
    .maybeSingle();
  return data?.value ?? null;
}

export async function savePersonalNote(supabase: SupabaseClient, galleryId: string, note: string | null | undefined): Promise<void> {
  if (note === undefined) return;
  const trimmed = note?.trim() || null;
  if (trimmed) {
    await supabase
      .from('app_settings')
      .upsert({ key: KEY_PREFIX + galleryId, value: trimmed }, { onConflict: 'key' });
  } else {
    await supabase
      .from('app_settings')
      .delete()
      .eq('key', KEY_PREFIX + galleryId);
  }
}
