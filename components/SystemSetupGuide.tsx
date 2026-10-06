'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';

interface SystemStatus {
  ai: boolean;
  emailKey: boolean;
  emailSandbox: boolean | null;
  fromAddress: string | null;
  adminLocked: boolean;
  userId: string;
  siteHost: string | null;
  imagesHost: string | null;
  supabaseHost: string | null;
}

// "⚙️ הגדרות מערכת" בדף הניהול - כל ההגדרות שנעשות מחוץ לאתר (Vercel, Resend,
// Anthropic, נטפרי) במקום אחד: סטטוס שנבדק בשרת + הוראות שלב-אחר-שלב.
export default function SystemSetupGuide() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/admin/system-status')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!status) return <p style={{ color: theme.textMuted, fontSize: 13 }}>בודקת הגדרות מערכת...</p>;

  const emailOk = status.emailKey && status.emailSandbox === false;
  const domains = [status.siteHost, status.imagesHost, status.supabaseHost].filter(Boolean) as string[];
  const netfreeText =
    `שלום, אני צלמת ומשתמשת במערכת לבחירת תמונות ללקוחות שלי.\n` +
    `אשמח לפתיחת האתר ושרת התמונות שלו, כדי שהתמונות יוצגו (כרגע הן מוצגות מטושטשות):\n` +
    domains.map((d) => `• ${d}`).join('\n') +
    `\nהתמונות הן צילומים משפחתיים צנועים שאני מעלה ללקוחות. תודה רבה!`;

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <h2 style={{ fontSize: 17, margin: '0 0 0.35rem' }}>⚙️ הגדרות מערכת</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, margin: '0 0 1rem' }}>
        הגדרות שנעשות מחוץ לאתר. הסטטוס נבדק אוטומטית בכל טעינה של הדף.
      </p>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <Card
          ok={status.adminLocked}
          title="🔒 נעילת הניהול לחשבון שלך"
          what="רק החשבון שלך יוכל להיכנס לדף הזה, גם אם מישהו אחר יירשם עם המייל שלך."
          steps={[
            <>נכנסים ל-<A href="https://vercel.com/dashboard">vercel.com</A> ← הפרויקט ← <b>Settings</b> ← <b>Environment Variables</b>.</>,
            <>מוסיפים משתנה בשם <Code>ADMIN_USER_ID</Code> עם הערך: <Copyable value={status.userId} /></>,
            <>שומרים, ואז ב-<b>Deployments</b> ← שלוש נקודות ← <b>Redeploy</b>.</>,
          ]}
        />
        <Card
          ok={emailOk}
          title="✉️ מיילים ללקוחות (דומיין ב-Resend)"
          what={
            !status.emailKey
              ? 'חסר מפתח Resend - כרגע לא נשלחים מיילים בכלל.'
              : status.emailSandbox
                ? `המיילים נשלחים מהכתובת ${status.fromAddress} - ממנה Resend שולח רק אלייך, לא ללקוחות.`
                : `המיילים נשלחים מ-${status.fromAddress}.`
          }
          steps={[
            ...(!status.emailKey
              ? [<>ב-<A href="https://resend.com/api-keys">resend.com ← API Keys</A> יוצרים מפתח, ומוסיפים אותו ב-Vercel בשם <Code>RESEND_API_KEY</Code> (ואז Redeploy).</>]
              : []),
            <>קונים דומיין (למשל אצל Namecheap או בעברית ב-domain.co.il), כ-50 ₪ לשנה.</>,
            <>ב-<A href="https://resend.com/domains">resend.com ← Domains</A> לוחצים <b>Add Domain</b>, ומעתיקים את רשומות ה-DNS שמופיעות אצל מי שקנית ממנו את הדומיין.</>,
            <>אחרי שהדומיין מסומן <b>Verified</b>, כותבים למטה בדף הזה, בשדה "כתובת שליחת מיילים", כתובת כמו <Code>gallery@הדומיין-שלך</Code>.</>,
          ]}
        />
        <Card
          ok={status.ai}
          title='🤖 מפתח AI ("עזרי לי לבחור")'
          what="מאפשר ללקוחה לקבל המלצות על התמונות הטובות. בתשלום לפי שימוש - בערך סנטים לניתוח."
          steps={[
            <>נכנסים ל-<A href="https://console.anthropic.com">console.anthropic.com</A> ונרשמים.</>,
            <>ב-<b>Billing</b> טוענים סכום קטן (למשל 5 דולר).</>,
            <>ב-<b>API Keys</b> לוחצים <b>Create Key</b> ומעתיקים (מתחיל ב-<Code>sk-ant-</Code>).</>,
            <>ב-Vercel מוסיפים משתנה <Code>ANTHROPIC_API_KEY</Code> עם המפתח, ואז Redeploy. את המפתח לא שולחים לאף אחד.</>,
          ]}
        />
        <Card
          ok={null}
          title="🛡️ נטפרי / סינון אינטרנט"
          what="מי שיש לו סינון (כולל את) רואה את התמונות מטושטשות עד שהסינון מאשר את האתר. אי אפשר לבדוק את זה אוטומטית."
          steps={[
            <>פונים לנטפרי (דרך האזור האישי באתר שלהם או בטלפון) ומבקשים לפתוח את הדומיינים: {domains.map((d) => <Code key={d}>{d}</Code>)}</>,
            <>נוסח מוכן להעתקה: <Copyable value={netfreeText} label="העתקת נוסח הפנייה" /></>,
            <>כדאי לשלוח את אותו נוסח גם ללקוחות שמשתמשות בסינון, כדי שיבקשו בעצמן.</>,
          ]}
        />
      </div>
    </section>
  );
}

function Card({ ok, title, what, steps }: { ok: boolean | null; title: string; what: string; steps: ReactNode[] }) {
  const [open, setOpen] = useState(ok === false);
  const badge =
    ok === true ? { text: '✅ מוגדר', color: theme.successText } : ok === false ? { text: '⚠️ חסר', color: theme.warningText } : { text: 'ℹ️ ידני', color: theme.textMuted };
  return (
    <div style={{ background: theme.panel, border: `1px solid ${ok === false ? theme.gold : theme.border}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', width: '100%' }}
      >
        <span style={{ fontWeight: 'bold' }}>{title}</span>
        <span style={{ color: badge.color, fontSize: 13, whiteSpace: 'nowrap' }}>
          {badge.text} {open ? '▲' : '▼'}
        </span>
      </button>
      <p style={{ color: theme.textMuted, fontSize: 13, margin: '0.4rem 0 0' }}>{what}</p>
      {open && (
        <ol style={{ margin: '0.6rem 0 0', paddingInlineStart: '1.2rem', fontSize: 13.5, lineHeight: 1.7 }}>
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: theme.gold }}>
      {children}
    </a>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '0.05rem 0.35rem', margin: '0 0.15rem', fontSize: 12.5 }}>
      {children}
    </code>
  );
}

function Copyable({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('להעתקה:', value);
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {!label && <Code>{value}</Code>}
      <button onClick={copy} style={{ ...outlineButtonStyle, padding: '0.2rem 0.7rem', fontSize: 12 }}>
        {copied ? 'הועתק ✓' : label ?? 'העתקה'}
      </button>
    </span>
  );
}
