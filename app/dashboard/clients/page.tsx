'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { theme, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { formatShekels } from '@/lib/payments';
import { filterClients, type ClientSummary } from '@/lib/clientGroups';
import { loadClientsData, clientHref, formatDate } from './loadClients';
import ClientDates from './ClientDates';

// רשימת הלקוחות - קריאה בלבד. כל השורות של אותה לקוחה (לפי מייל, ראו
// lib/clientGroups.ts) מאוחדות לשורה אחת, ממוינות לפי פעילות אחרונה.
export default function ClientsPage() {
  const [supabase] = useState(() => createClient());
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // הלקוחה שהבלוק "תאריכים חשובים" שלה פתוח (אחת בכל פעם)
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState('');

  async function handleDeleteClient(c: ClientSummary) {
    if (c.galleryCount > 0 || c.shootCount > 0) {
      setDeleteMessage(`אי אפשר למחוק את ${c.name || 'הלקוחה'} — יש לה ${c.galleryCount ? `${c.galleryCount} גלריות` : ''}${c.galleryCount && c.shootCount ? ' ו-' : ''}${c.shootCount ? `${c.shootCount} צילומים` : ''}. מחקי אותם קודם.`);
      setConfirmingDeleteKey(null);
      setTimeout(() => setDeleteMessage(''), 5000);
      return;
    }
    setDeletingKey(c.key);
    let failed = false;
    for (const id of c.clientIds) {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      if (!res.ok) failed = true;
    }
    setDeletingKey(null);
    setConfirmingDeleteKey(null);
    if (failed) {
      setDeleteMessage('מחיקת הלקוחה נכשלה');
      setTimeout(() => setDeleteMessage(''), 4000);
    } else {
      setClients((prev) => prev.filter((x) => x.key !== c.key));
      setDeleteMessage(`${c.name || 'הלקוחה'} נמחקה`);
      setTimeout(() => setDeleteMessage(''), 3000);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadClientsData(supabase);
      setClients(data.clients);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => filterClients(clients, searchQuery), [clients, searchQuery]);

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  if (loadError) {
    return (
      <div>
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          טעינת רשימת הלקוחות נכשלה: {loadError}
        </p>
        <button onClick={load} style={outlineButtonStyle}>
          נסי שוב
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: '1rem', color: theme.gold, fontFamily: theme.fontSerif }}>הלקוחות שלי</h1>

      <input
        type="search"
        placeholder="חיפוש לפי שם או מייל..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: '1rem' }}
      />

      {deleteMessage && (
        <p style={{ background: deleteMessage.includes('נכשלה') || deleteMessage.includes('אי אפשר') ? theme.errorBg : theme.panel, color: deleteMessage.includes('נכשלה') || deleteMessage.includes('אי אפשר') ? theme.errorText : theme.text, padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '0.75rem', fontSize: 13, border: `1px solid ${theme.border}` }}>
          {deleteMessage}
        </p>
      )}

      {clients.length === 0 ? (
        <p style={{ color: theme.textMuted }}>
          עדיין אין לקוחות. לקוחה נוספת אוטומטית כשאת יוצרת לה{' '}
          <Link href="/dashboard/galleries/new" style={{ color: theme.gold }}>
            גלריה
          </Link>{' '}
          או{' '}
          <Link href="/dashboard/calendar" style={{ color: theme.gold }}>
            צילום ביומן
          </Link>
          .
        </p>
      ) : visible.length === 0 ? (
        <p style={{ color: theme.textMuted }}>לא נמצאו לקוחות שמתאימות לחיפוש.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: theme.textMuted, textAlign: 'right' }}>
                <th style={th}>שם</th>
                <th style={th}>מייל</th>
                <th style={th}>גלריות</th>
                <th style={th}>צילומים</th>
                <th style={th}>פעילות אחרונה</th>
                <th style={th}>שולם</th>
                <th style={th}>יתרה לתשלום</th>
                <th style={th}>תאריכים חשובים</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <Fragment key={c.key}>
                <tr style={{ borderTop: `1px solid ${theme.border}` }}>
                  <td style={td}>
                    <Link href={clientHref(c.key)} style={{ color: theme.text, fontWeight: 600 }}>
                      {c.name || '(ללא שם)'}
                    </Link>
                  </td>
                  <td style={{ ...td, direction: 'ltr', textAlign: 'right', color: theme.textMuted }}>{c.email || '—'}</td>
                  <td style={td}>{c.galleryCount}</td>
                  <td style={td}>{c.shootCount}</td>
                  <td style={td}>{formatDate(c.lastActivity)}</td>
                  <td style={td}>{formatShekels(c.totalPaid)}</td>
                  <td style={{ ...td, color: c.balanceDue > 0 ? theme.warningText : theme.textMuted }}>{formatShekels(c.balanceDue)}</td>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => setExpandedKey((k) => (k === c.key ? null : c.key))}
                      aria-expanded={expandedKey === c.key}
                      style={{ background: 'none', border: 'none', color: theme.gold, cursor: 'pointer', fontSize: 13, padding: 0 }}
                    >
                      📅 {expandedKey === c.key ? 'סגירה' : 'תאריכים'}
                    </button>
                  </td>
                  <td style={td}>
                    {confirmingDeleteKey === c.key ? (
                      <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: 12 }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteClient(c)}
                          disabled={deletingKey === c.key}
                          style={{ ...outlineButtonStyle, padding: '0.25rem 0.5rem', fontSize: 11, color: theme.errorText, borderColor: theme.errorText }}
                        >
                          {deletingKey === c.key ? '...' : 'כן'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteKey(null)}
                          style={{ ...outlineButtonStyle, padding: '0.25rem 0.5rem', fontSize: 11 }}
                        >
                          לא
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setConfirmingDeleteKey(c.key); setDeleteMessage(''); }}
                        style={{ background: 'none', border: 'none', color: theme.textFaint, cursor: 'pointer', fontSize: 12, padding: 0 }}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
                {expandedKey === c.key && (
                  <tr>
                    <td colSpan={9} style={{ padding: '0 0.5rem 0.75rem', background: theme.panelInput }}>
                      <ClientDates supabase={supabase} clientIds={c.clientIds} clientName={c.name} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '0.5rem', fontWeight: 500, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '0.6rem 0.5rem', whiteSpace: 'nowrap' };
