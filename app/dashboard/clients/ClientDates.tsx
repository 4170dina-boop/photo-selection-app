'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { theme, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { HEBREW_MONTH_NAMES_HE, numberToHebrewLetters } from '@/lib/hebrewDate';
import { israelDateString, daysBetweenDateStrings } from '@/lib/israelTime';
import {
  parseClientDateInput,
  nextClientDateOccurrence,
  describeClientDateRule,
  CLIENT_DATE_LABEL_MAX_LENGTH,
  CLIENT_DATE_REMINDER_DAYS,
  isMissingTableError,
  type ClientDateRow,
} from '@/lib/clientDates';
import { formatDate } from './loadClients';

// תאריכים חשובים של לקוחה (טבלת client_dates) - נפתח מתוך שורת הלקוחה ברשימה.
// לקוחה "לוגית" יכולה להיות כמה שורות clients (lib/clientGroups.ts) - מציגים
// את התאריכים של כולן, ותאריך חדש נשמר על השורה הראשונה. כתיבה ישירה עם
// session הצלמת - ה-RLS (supabase/schema.sql) בודק שהלקוחה שלה.

const MONTH_OPTIONS: { value: number; label: string }[] = Object.entries(HEBREW_MONTH_NAMES_HE).map(([value, name]) => ({
  value: Number(value),
  label: Number(value) === 6 ? 'אדר א׳ (בשנה מעוברת)' : Number(value) === 7 ? 'אדר / אדר ב׳' : name,
}));
// סדר התצוגה: אדר א׳ לפני אדר ב׳ - כבר לפי המספור (6, 7)
const DAY_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

function nextOccurrenceText(row: ClientDateRow, today: string): string {
  const next = nextClientDateOccurrence(row, today);
  if (!next) return '';
  const days = daysBetweenDateStrings(today, next);
  if (days === 0) return 'היום! 🎉';
  if (days === 1) return `מחר (${formatDate(next)})`;
  return `בעוד ${days} ימים (${formatDate(next)})`;
}

export default function ClientDates({
  supabase,
  clientIds,
  clientName,
}: {
  supabase: SupabaseClient;
  clientIds: string[];
  clientName: string;
}) {
  const [rows, setRows] = useState<ClientDateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'greg' | 'hebrew'>('greg');
  const [dateGreg, setDateGreg] = useState('');
  const [hebrewMonth, setHebrewMonth] = useState('1');
  const [hebrewDay, setHebrewDay] = useState('1');
  const [saving, setSaving] = useState(false);
  const today = israelDateString(new Date());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: loadError } = await supabase
        .from('client_dates')
        .select('id, client_id, label, date_greg, hebrew_month, hebrew_day, created_at')
        .in('client_id', clientIds)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (loadError) {
        if (isMissingTableError(loadError)) setMissingTable(true);
        else setError('טעינת התאריכים נכשלה');
      } else {
        setRows((data ?? []) as ClientDateRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, clientIds]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = parseClientDateInput(
      kind === 'greg' ? { label, dateGreg } : { label, hebrewMonth, hebrewDay }
    );
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    const { data: photographer } = await supabase.from('photographers').select('id').maybeSingle();
    if (!photographer?.id) {
      setSaving(false);
      setError('לא הצלחנו לזהות את החשבון, נסי לרענן');
      return;
    }
    const { data, error: insertError } = await supabase
      .from('client_dates')
      .insert({ ...parsed.value, client_id: clientIds[0], photographer_id: photographer.id })
      .select('id, client_id, label, date_greg, hebrew_month, hebrew_day, created_at')
      .single();
    setSaving(false);
    if (insertError || !data) {
      if (insertError && isMissingTableError(insertError)) setMissingTable(true);
      setError('שמירת התאריך נכשלה, נסי שוב');
      return;
    }
    setRows((r) => [...r, data as ClientDateRow]);
    setLabel('');
    setDateGreg('');
  }

  async function handleDelete(id: string) {
    setError('');
    const { error: deleteError } = await supabase.from('client_dates').delete().eq('id', id);
    if (deleteError) {
      setError('המחיקה נכשלה, נסי שוב');
      return;
    }
    setRows((r) => r.filter((row) => row.id !== id));
  }

  if (loading) return <p style={{ color: theme.textMuted, fontSize: 13 }}>טוען...</p>;

  if (missingTable) {
    return (
      <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: 13 }}>
        כדי לשמור תאריכים חשובים צריך להריץ פעם אחת את המיגרציה &quot;אוטומציות&quot; בסוף supabase/schema.sql.
      </p>
    );
  }

  return (
    <div style={{ padding: '0.75rem 0.5rem', whiteSpace: 'normal' }}>
      <p style={{ fontSize: 13, color: theme.textMuted, margin: '0 0 0.6rem' }}>
        📅 תאריכים חשובים של {clientName || 'הלקוחה'} - תקבלי תזכורת בסיכום היומי {CLIENT_DATE_REMINDER_DAYS} יום לפני, עם הצעה לברכה.
      </p>

      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {rows.map((row) => (
            <li key={row.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <b>{row.label}</b>
              <span style={{ color: theme.textMuted }}>{describeClientDateRule(row)}</span>
              <span style={{ color: theme.textFaint }}>{nextOccurrenceText(row, today)}</span>
              <button
                type="button"
                onClick={() => handleDelete(row.id)}
                aria-label={`מחיקת ${row.label}`}
                style={{ background: 'none', border: 'none', color: theme.textFaint, cursor: 'pointer', fontSize: 12, padding: 0 }}
              >
                ✕ הסרה
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="למשל: יום ההולדת של יוסי"
          maxLength={CLIENT_DATE_LABEL_MAX_LENGTH}
          style={{ ...inputStyle, minWidth: 180 }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as 'greg' | 'hebrew')} style={inputStyle} aria-label="סוג התאריך">
          <option value="greg">תאריך לועזי</option>
          <option value="hebrew">תאריך עברי</option>
        </select>
        {kind === 'greg' ? (
          <input type="date" value={dateGreg} onChange={(e) => setDateGreg(e.target.value)} style={inputStyle} aria-label="תאריך לועזי" />
        ) : (
          <>
            <select value={hebrewDay} onChange={(e) => setHebrewDay(e.target.value)} style={inputStyle} aria-label="יום בחודש העברי">
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {numberToHebrewLetters(d)}
                </option>
              ))}
            </select>
            <select value={hebrewMonth} onChange={(e) => setHebrewMonth(e.target.value)} style={inputStyle} aria-label="חודש עברי">
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" disabled={saving} style={{ ...outlineButtonStyle, padding: '0.4rem 0.9rem', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'שומרת...' : 'הוספה'}
        </button>
      </form>

      {error && <p style={{ color: theme.errorText, fontSize: 13, margin: '0.5rem 0 0' }}>{error}</p>}
    </div>
  );
}
