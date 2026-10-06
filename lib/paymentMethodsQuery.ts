import { isMissingColumnError } from '@/lib/gender';
import { normalizePaymentMethods, type PaymentMethod } from '@/lib/paymentMethods';

// קריאת אמצעי התשלום של צלמת מה-DB (lib/paymentMethods.ts) - משותף ל-
// app/api/photographer, app/api/gallery/[id]/progress ו-payment-choice.
// best-effort: לעולם לא זורק.
//  * 'methods' - העמודה payment_methods קיימת (גם אם עוד null -> נגזר מהישנות)
//  * 'legacy'  - payment_methods חסרה (מיגרציה שלא רצה) - רק העמודות הישנות
//  * 'none'    - גם הישנות חסרות / שגיאה - אין אמצעי תשלום

export type PaymentMethodsSource = 'methods' | 'legacy' | 'none';

// טיפוס מינימלי במכוון - מתאים גם ל-service_role client וגם ללקוח השרת עם session.
interface SupabaseLike {
  from: (table: string) => any;
}

export async function loadPaymentMethods(
  supabase: SupabaseLike,
  photographerId: string | null | undefined
): Promise<{ methods: PaymentMethod[]; source: PaymentMethodsSource }> {
  const empty = { methods: normalizePaymentMethods(null), source: 'none' as const };
  if (!photographerId) return empty;
  try {
    const { data, error } = await supabase
      .from('photographers')
      .select('payment_methods, payment_bit_url, payment_paybox_url, payment_bank_details')
      .eq('id', photographerId)
      .maybeSingle();
    if (!error) return { methods: normalizePaymentMethods(data), source: 'methods' };
    if (!isMissingColumnError(error)) return empty;

    const legacy = await supabase
      .from('photographers')
      .select('payment_bit_url, payment_paybox_url, payment_bank_details')
      .eq('id', photographerId)
      .maybeSingle();
    if (legacy.error) return empty;
    return { methods: normalizePaymentMethods(legacy.data), source: 'legacy' };
  } catch {
    return empty;
  }
}
