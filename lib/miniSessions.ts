import { isShabbatOrYomTovIsrael } from '@/lib/jewishCalendar';

export interface MiniSessionSlotRule {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  duration_minutes: number;
  price: number | null;
  deposit: number | null;
  is_active: boolean;
}

export function isMiniSessionDayBlocked(dateStr: string): boolean {
  return isShabbatOrYomTovIsrael(dateStr);
}

function parseMinutes(time: string): number {
  const [hh = '0', mm = '0'] = time.split(':');
  return Number(hh) * 60 + Number(mm);
}

export function buildMiniSessionSlots(dateStr: string, durationMinutes: number, startTime: string, endTime: string): string[] {
  if (durationMinutes <= 0 || isMiniSessionDayBlocked(dateStr)) return [];
  const start = parseMinutes(startTime);
  const end = parseMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const slots: string[] = [];
  for (let t = start; t + durationMinutes <= end; t += durationMinutes) {
    const hours = String(Math.floor(t / 60)).padStart(2, '0');
    const minutes = String(t % 60).padStart(2, '0');
    slots.push(`${hours}:${minutes}`);
  }
  return slots;
}

export function getAvailableMiniSessionSlots(
  dateStr: string,
  durationMinutes: number,
  startTime: string,
  endTime: string,
  bookedSlots: string[] = [],
): string[] {
  const allSlots = buildMiniSessionSlots(dateStr, durationMinutes, startTime, endTime);
  return allSlots.filter((slot) => !bookedSlots.includes(slot));
}

export function validateMiniSessionInput(input: {
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  durationMinutes?: unknown;
  price?: unknown;
  deposit?: unknown;
  notes?: unknown;
}): { ok: true; value: { date: string; start_time: string; end_time: string; duration_minutes: number; price: number | null; deposit: number | null; notes: string | null } } | { ok: false; error: string } {
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: 'תאריך המיני-סשן לא תקין' };
  }
  if (isMiniSessionDayBlocked(input.date)) {
    return { ok: false, error: 'לא ניתן ליצור מיני-סשן בשבת או בחג' };
  }
  if (typeof input.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    return { ok: false, error: 'שעת התחלה לא תקינה' };
  }
  if (typeof input.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime)) {
    return { ok: false, error: 'שעת סיום לא תקינה' };
  }

  const duration = Number(input.durationMinutes);
  if (!Number.isInteger(duration) || duration <= 0 || duration > 180) {
    return { ok: false, error: 'משך המיני-סשן חייב להיות בין 1 ל-180 דקות' };
  }
  if (parseMinutes(input.endTime) <= parseMinutes(input.startTime)) {
    return { ok: false, error: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' };
  }

  const price = input.price === undefined || input.price === null || input.price === '' ? null : Number(input.price);
  const deposit = input.deposit === undefined || input.deposit === null || input.deposit === '' ? null : Number(input.deposit);
  if ((price !== null && (!Number.isFinite(price) || price < 0)) || (deposit !== null && (!Number.isFinite(deposit) || deposit < 0))) {
    return { ok: false, error: 'המחיר והמקדמה חייבים להיות מספרים חיוביים' };
  }

  const notes = typeof input.notes === 'string' ? input.notes.trim() || null : null;
  return {
    ok: true,
    value: {
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_minutes: duration,
      price: price === null ? null : Number(price.toFixed(2)),
      deposit: deposit === null ? null : Number(deposit.toFixed(2)),
      notes,
    },
  };
}

export function validateMiniSessionBookingInput(input: {
  clientName?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
  selectedSlot?: unknown;
}): { ok: true; value: { client_name: string; phone: string; email: string; notes: string | null; selected_slot: string | null } } | { ok: false; error: string } {
  const clientName = typeof input.clientName === 'string' ? input.clientName.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim() || null : null;
  const selectedSlot = typeof input.selectedSlot === 'string' ? input.selectedSlot.trim() || null : null;

  if (!clientName) {
    return { ok: false, error: 'שם הלקוחה הוא שדה חובה' };
  }
  if (!phone) {
    return { ok: false, error: 'טלפון הוא שדה חובה' };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'אימייל לא תקין' };
  }
  if (selectedSlot && !/^([01]\d|2[0-3]):[0-5]\d$/.test(selectedSlot)) {
    return { ok: false, error: 'השעה שנבחרה לא תקינה' };
  }

  return {
    ok: true,
    value: {
      client_name: clientName,
      phone,
      email,
      notes,
      selected_slot: selectedSlot,
    },
  };
}

export function validateMiniSessionBookingStatus(input: unknown): { ok: true; value: 'confirmed' | 'cancelled' } | { ok: false; error: string } {
  if (input === 'confirmed' || input === 'cancelled') {
    return { ok: true, value: input };
  }
  return { ok: false, error: 'סטטוס ההזמנה לא תקין' };
}
