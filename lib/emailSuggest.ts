// השלמה אוטומטית לכתובות מייל: אחרי שם המשתמש מציעה "@gmail.com" וכו',
// אחרי "@" מציעה דומיינים נפוצים שמתאימים למה שהוקלד, ולדומיין לא מוכר
// מציעה סיומות (.com / .co.il ...). לוגיקה טהורה - הרכיב ב-components/EmailInput.

// סדר = סדר ההצעה. דומיינים נפוצים בישראל קודם.
export const COMMON_EMAIL_DOMAINS = [
  'gmail.com',
  'walla.co.il',
  'hotmail.com',
  'yahoo.com',
  'outlook.com',
  'icloud.com',
  'live.com',
  'bezeqint.net',
  'netvision.net.il',
  '012.net.il',
  'zahav.net.il',
  'outlook.co.il',
];

export const COMMON_EMAIL_SUFFIXES = ['.com', '.co.il', '.net', '.org.il', '.org', '.net.il', '.ac.il', '.gov.il'];

export function emailSuggestions(value: string, max = 4): string[] {
  const v = value.trim();
  if (!v || /\s/.test(v)) return [];

  const at = v.indexOf('@');
  if (at === -1) return COMMON_EMAIL_DOMAINS.slice(0, max).map((d) => `${v}@${d}`);
  if (v.indexOf('@', at + 1) !== -1) return [];

  const local = v.slice(0, at);
  if (!local) return [];
  const domain = v.slice(at + 1).toLowerCase();

  const out: string[] = [];
  const push = (d: string) => {
    const s = `${local}@${d}`;
    if (d !== domain && !out.includes(s)) out.push(s);
  };

  for (const d of COMMON_EMAIL_DOMAINS) if (d.startsWith(domain)) push(d);

  // דומיין לא מהרשימה (למשל דומיין של עסק) - משלימים רק את הסיומת
  const dot = domain.indexOf('.');
  const base = dot === -1 ? domain : domain.slice(0, dot);
  const rest = dot === -1 ? '' : domain.slice(dot);
  if (base) for (const s of COMMON_EMAIL_SUFFIXES) if (s.startsWith(rest)) push(base + s);

  return out.slice(0, max);
}
