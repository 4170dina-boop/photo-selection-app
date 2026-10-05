'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatShekels } from '@/lib/payments';
import { formatShootTime } from '@/lib/shoots';
import type { ClientSummary } from '@/lib/clientGroups';
import {
  loadClientsData,
  formatDate,
  newGalleryHref,
  newShootHref,
  type ClientGallery,
  type ClientShoot,
} from '../loadClients';

// דף לקוחה (קריאה בלבד): הגלריות, הצילומים וסיכום התשלומים של כל השורות
// ב-clients שמאוחדות ללקוחה הזו (lib/clientGroups.ts).

const panelStyle: React.CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  padding: '1rem',
  marginBottom: '1rem',
};

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
    case 'sent':
      return 'ממתין לפתיחה';
    case 'in_progress':
      return 'בבחירה';
    case 'completed':
      return 'הושלם';
    case 'expired':
      return 'באיחור';
    default:
      return status;
  }
}

// params ב-Next 14 יכולים להגיע עדיין מקודדים (למשל %40 במקום @ או עברית)
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function ClientDetailPage({ params }: { params: { key: string } }) {
  const key = safeDecode(params.key);
  const [supabase] = useState(() => createClient());
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [galleries, setGalleries] = useState<ClientGallery[]>([]);
  const [shoots, setShoots] = useState<ClientShoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadClientsData(supabase);
      const found = data.clients.find((c) => c.key === key) ?? null;
      setClient(found);
      if (found) {
        setGalleries(found.galleryIds.map((id) => data.galleries.get(id)!).filter(Boolean));
        setShoots(found.shootIds.map((id) => data.shoots.get(id)!).filter(Boolean));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  if (loadError) {
    return (
      <div>
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          טעינת פרטי הלקוחה נכשלה: {loadError}
        </p>
        <button onClick={load} style={outlineButtonStyle}>
          נסי שוב
        </button>
      </div>
    );
  }

  if (!client) {
    return (
      <div>
        <p style={{ color: theme.textMuted, marginBottom: '1rem' }}>הלקוחה לא נמצאה.</p>
        <Link href="/dashboard/clients" style={{ color: theme.gold }}>
          → חזרה לרשימת הלקוחות
        </Link>
      </div>
    );
  }

  const totalDue = galleries.reduce((sum, g) => sum + Math.round(g.summary.total * 100), 0) / 100;

  return (
    <div>
      <Link href="/dashboard/clients" style={{ color: theme.textMuted, fontSize: 14 }}>
        → כל הלקוחות
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', margin: '0.75rem 0 1rem' }}>
        <div>
          <h1 style={{ fontSize: 22, color: theme.gold, fontFamily: theme.fontSerif, margin: 0 }}>{client.name || '(ללא שם)'}</h1>
          {client.email && (
            <div style={{ color: theme.textMuted, direction: 'ltr', textAlign: 'right', fontSize: 14 }}>{client.email}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href={newGalleryHref(client)} style={{ ...goldButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
            גלריה חדשה ללקוחה
          </Link>
          <Link href={newShootHref(client)} style={{ ...outlineButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
            צילום חדש
          </Link>
        </div>
      </div>

      <section style={panelStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>סיכום תשלומים</h2>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: 14 }}>
          <div>
            <div style={{ color: theme.textMuted }}>סה״כ לתשלום</div>
            <div style={{ fontSize: 18 }}>{formatShekels(totalDue)}</div>
          </div>
          <div>
            <div style={{ color: theme.textMuted }}>שולם</div>
            <div style={{ fontSize: 18, color: theme.successText }}>{formatShekels(client.totalPaid)}</div>
          </div>
          <div>
            <div style={{ color: theme.textMuted }}>יתרה לתשלום</div>
            <div style={{ fontSize: 18, color: client.balanceDue > 0 ? theme.warningText : theme.text }}>{formatShekels(client.balanceDue)}</div>
          </div>
        </div>
      </section>

      <section style={panelStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>גלריות ({galleries.length})</h2>
        {galleries.length === 0 ? (
          <p style={{ color: theme.textMuted, margin: 0 }}>עדיין אין גלריות ללקוחה הזו.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {galleries.map((g) => (
              <li
                key={g.id}
                style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', padding: '0.6rem 0', borderTop: `1px solid ${theme.border}`, fontSize: 14 }}
              >
                <Link href={`/dashboard/galleries/${g.id}/edit`} style={{ color: theme.text }}>
                  גלריה מ-{formatDate(g.created_at)} · {statusLabel(g.status)}
                  {g.delivered_at ? ' · נמסרה' : ''}
                </Link>
                <span style={{ color: theme.textMuted }}>
                  {formatShekels(g.summary.total)} · שולם {formatShekels(g.summary.paid)}
                  {g.summary.outstanding > 0 ? (
                    <span style={{ color: theme.warningText }}> · נותר {formatShekels(g.summary.outstanding)}</span>
                  ) : g.paid_at ? (
                    <span style={{ color: theme.successText }}> · שולמה</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={panelStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>צילומים ({shoots.length})</h2>
        {shoots.length === 0 ? (
          <p style={{ color: theme.textMuted, margin: 0 }}>עדיין אין צילומים ביומן ללקוחה הזו.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {shoots.map((s) => (
              <li key={s.id} style={{ padding: '0.6rem 0', borderTop: `1px solid ${theme.border}`, fontSize: 14 }}>
                <Link href="/dashboard/calendar" style={{ color: theme.text }}>
                  {formatDate(s.shoot_date)} · {formatShootTime(s.start_time)} · {s.location}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
